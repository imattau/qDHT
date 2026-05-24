import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WebSocket } from 'ws'
import { generateKeypair } from '../core/identity/keys.js'
import { signEvent } from '../core/identity/signing.js'
import { QDHTNode } from './qdht-node.js'
import { MemoryNodeStorage } from '../core/storage/memory-node-storage.js'
import { QDHT_KIND } from '../core/nostr/kinds.js'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(fn: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await wait(30)
  }
}

describe('Bootstrap node integration', () => {
  let bootstrap: QDHTNode
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'qdht-bsi-'))
    const kp = generateKeypair()
    bootstrap = new QDHTNode(
      {
        identity: { privkey: kp.privkey },
        peers: [],
        port: 0,
        dataDir: tmpDir,
        bootstrapMode: true,
      },
      new MemoryNodeStorage(),
    )
    await bootstrap.start()
  })

  afterEach(async () => {
    await bootstrap.stop()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('fans out a 30181 from peer1 to peer2', async () => {
    const port = bootstrap.listenPort()
    const peer1Kp = generateKeypair()
    const peer2Kp = generateKeypair()

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`)
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`)

    const peer2Messages: Array<Record<string, unknown>> = []
    ws2.on('message', (data: import('ws').RawData) => {
      try { peer2Messages.push(JSON.parse(data.toString())) } catch { /* ignore */ }
    })

    async function handshake(ws: WebSocket, pubkey: string): Promise<void> {
      await new Promise<void>((resolve) => {
        const doSend = (): void => {
          ws.send(JSON.stringify({ type: 'handshake', pubkey }))
          resolve()
        }
        ws.readyState === WebSocket.OPEN ? doSend() : ws.on('open', doSend)
      })
    }

    await handshake(ws1, peer1Kp.pubkey)
    await handshake(ws2, peer2Kp.pubkey)
    await wait(150)

    const record = signEvent(
      {
        kind: QDHT_KIND.SERVICE_RECORD,
        pubkey: peer1Kp.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['transport', 'ws'], ['d', 'main'], ['url', 'ws://peer1:7777']],
        content: '',
        sig: '',
      },
      peer1Kp.privkey,
    )
    ws1.send(JSON.stringify(record))

    await waitFor(() =>
      peer2Messages.some(
        (m) => m.kind === QDHT_KIND.SERVICE_RECORD && m.pubkey === peer1Kp.pubkey,
      ),
    )

    // Confirm peer2 also received a 30800 address reflection
    const reflection = peer2Messages.find((m) => m.kind === 30800)
    expect(reflection).toBeDefined()

    ws1.close()
    ws2.close()
  })

  it('sends existing cache to a late-joining peer', async () => {
    const port = bootstrap.listenPort()
    const peer1Kp = generateKeypair()
    const peer2Kp = generateKeypair()

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`)
    await new Promise<void>((resolve) => (ws1.readyState === WebSocket.OPEN ? resolve() : ws1.on('open', resolve)))
    ws1.send(JSON.stringify({ type: 'handshake', pubkey: peer1Kp.pubkey }))

    const record = signEvent(
      {
        kind: QDHT_KIND.SERVICE_RECORD,
        pubkey: peer1Kp.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['transport', 'ws'], ['d', 'main'], ['url', 'ws://peer1:7777']],
        content: '',
        sig: '',
      },
      peer1Kp.privkey,
    )
    ws1.send(JSON.stringify(record))
    await wait(100) // let bootstrap cache it

    // Now peer2 joins
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`)
    const peer2Messages: Array<Record<string, unknown>> = []
    ws2.on('message', (data: import('ws').RawData) => {
      try { peer2Messages.push(JSON.parse(data.toString())) } catch { /* ignore */ }
    })
    await new Promise<void>((resolve) => (ws2.readyState === WebSocket.OPEN ? resolve() : ws2.on('open', resolve)))
    ws2.send(JSON.stringify({ type: 'handshake', pubkey: peer2Kp.pubkey }))

    await waitFor(() =>
      peer2Messages.some(
        (m) => m.kind === QDHT_KIND.SERVICE_RECORD && m.pubkey === peer1Kp.pubkey,
      ),
    )

    ws1.close()
    ws2.close()
  })
})
