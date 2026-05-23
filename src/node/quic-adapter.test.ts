import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QDHTNode } from './qdht-node.js'
import type { QDHTConfig } from './config.js'

let tmpRoot = ''
let nodeA: QDHTNode | undefined
let nodeB: QDHTNode | undefined

async function waitFor(fn: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'qdht-quic-'))
})

afterEach(async () => {
  await nodeB?.stop()
  await nodeA?.stop()
  await rm(tmpRoot, { recursive: true, force: true })
  nodeA = undefined
  nodeB = undefined
})

describe('QUIC transport integration', () => {
  it('connects nodes and propagates announcements over QUIC', async () => {
    const dirA = join(tmpRoot, 'a')
    const dirB = join(tmpRoot, 'b')
    const configA: QDHTConfig = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      quicPeers: [],
      quicListenPort: 20910,
      port: 19910,
      dataDir: dirA,
    }
    const configB: QDHTConfig = {
      identity: { privkey: 'b'.repeat(64) },
      peers: [],
      quicPeers: ['quic://127.0.0.1:20910'],
      quicListenPort: 20911,
      port: 19911,
      dataDir: dirB,
    }

    nodeA = new QDHTNode(configA)
    nodeB = new QDHTNode(configB)

    const a = nodeA
    const b = nodeB

    await a.start()
    await b.start()

    await waitFor(() => a.peerCount() > 0 && b.peerCount() > 0)

    const loc = await b.put(Buffer.from('hello over quic'), { name: 'hello.txt', ttl: 3600 })
    await waitFor(() => a.hasReceivedKey(loc.qkey))

    expect(a.peerCount()).toBeGreaterThan(0)
    expect(b.peerCount()).toBeGreaterThan(0)
    expect(a.hasReceivedKey(loc.qkey)).toBe(true)
  })
})
