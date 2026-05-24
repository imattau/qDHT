import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { PeerManager } from './peer-manager.js'

let port = 19800

function nextPort(): number {
  return port++
}

async function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timeout waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function safeClose(ws: WebSocket): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.close()
    } catch {
      // ignore teardown races in tests
    }
  }
}

describe('PeerManager', () => {
  let pm: PeerManager | undefined

  afterEach(async () => {
    await pm?.close()
    pm = undefined
  })

  it('starts a WS server and accepts connections', async () => {
    const p = nextPort()
    pm = new PeerManager({ port: p, pubkey: 'a'.repeat(64), privkey: 'a'.repeat(64) })
    await pm.listen()

    const ws = new WebSocket(`ws://127.0.0.1:${p}`)
    await waitFor(() => pm!.peers().length > 0)
    expect(pm!.peers().length).toBe(1)
    safeClose(ws)
  })

  it('reports pubkey from handshake in peers()', async () => {
    const p = nextPort()
    pm = new PeerManager({ port: p, pubkey: 'a'.repeat(64), privkey: 'a'.repeat(64) })
    await pm.listen()

    const peerPubkey = 'b'.repeat(64)
    const ws = new WebSocket(`ws://127.0.0.1:${p}`)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'handshake', pubkey: peerPubkey }))
    })

    await waitFor(() => pm!.peers().some((peer) => peer.pubkey === peerPubkey))
    expect(pm!.peers().find((peer) => peer.pubkey === peerPubkey)).toBeDefined()
    safeClose(ws)
  })

  it('calls transport-compatible peer connected handlers on handshake', async () => {
    const p = nextPort()
    pm = new PeerManager({ port: p, pubkey: 'a'.repeat(64), privkey: 'a'.repeat(64) })
    await pm.listen()

    const peerPubkey = 'd'.repeat(64)
    const seen: string[] = []
    pm.onPeerConnected((peerId: string) => {
      seen.push(peerId)
    })

    const ws = new WebSocket(`ws://127.0.0.1:${p}`)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'handshake', pubkey: peerPubkey }))
    })

    await waitFor(() => seen.includes(peerPubkey))
    expect(seen).toContain(peerPubkey)
    safeClose(ws)
  })

  it('calls onMessage handler when a peer sends a message', async () => {
    const p = nextPort()
    pm = new PeerManager({ port: p, pubkey: 'a'.repeat(64), privkey: 'a'.repeat(64) })
    await pm.listen()

    const received: unknown[] = []
    pm.onMessage((msg) => received.push(msg))

    const ws = new WebSocket(`ws://127.0.0.1:${p}`)
    ws.on('open', () => {
      ws.send(JSON.stringify({ kind: 10800, pubkey: 'c'.repeat(64) }))
    })

    await waitFor(() => received.length > 0)
    expect(received[0]).toMatchObject({ kind: 10800 })
    safeClose(ws)
  })

  it('removes peer from peers() when connection closes', async () => {
    const p = nextPort()
    pm = new PeerManager({ port: p, pubkey: 'a'.repeat(64), privkey: 'a'.repeat(64) })
    await pm.listen()

    const ws = new WebSocket(`ws://127.0.0.1:${p}`)
    await waitFor(() => pm!.peers().length > 0)
    safeClose(ws)
    await waitFor(() => pm!.peers().length === 0)
    expect(pm!.peers().length).toBe(0)
  })

  it('sends a kind 30181 event after handshake when listenAddress is set', async () => {
    const p = nextPort()
    pm = new PeerManager({
      port: p,
      pubkey: 'a'.repeat(64),
      privkey: 'a'.repeat(64),
      listenAddress: `ws://127.0.0.1:${p}`,
    })
    await pm.listen()

    const received: unknown[] = []
    const client = new WebSocket(`ws://127.0.0.1:${p}`)
    client.on('message', (data: import('ws').RawData) => {
      received.push(JSON.parse(data.toString()))
    })

    // Send handshake so PeerManager fires registerPeerPubkey
    await new Promise<void>((resolve) => {
      client.on('open', () => {
        client.send(JSON.stringify({ type: 'handshake', pubkey: 'b'.repeat(64) }))
        resolve()
      })
    })

    await waitFor(() => received.length >= 2) // handshake response + 30181

    const serviceRecord = (received as Array<Record<string, unknown>>).find(
      (m) => m.kind === 30181,
    )
    expect(serviceRecord).toBeDefined()
    expect(typeof (serviceRecord as Record<string, unknown>).pubkey).toBe('string')

    const tags = (serviceRecord as Record<string, unknown>).tags as string[][]
    expect(tags.some(([k, v]) => k === 'url' && v === `ws://127.0.0.1:${p}`)).toBe(true)
    expect(tags.some(([k, v]) => k === 'd' && v === 'main')).toBe(true)
    expect(tags.some(([k]) => k === 'transport')).toBe(true)
    safeClose(client)
  })

  it('does not send 30181 when listenAddress is not set', async () => {
    const p = nextPort()
    pm = new PeerManager({ port: p, pubkey: 'c'.repeat(64), privkey: 'c'.repeat(64) })
    await pm.listen()

    const received: unknown[] = []
    const client = new WebSocket(`ws://127.0.0.1:${p}`)
    client.on('message', (data: import('ws').RawData) => {
      received.push(JSON.parse(data.toString()))
    })

    await new Promise<void>((resolve) => {
      client.on('open', () => {
        client.send(JSON.stringify({ type: 'handshake', pubkey: 'd'.repeat(64) }))
        resolve()
      })
    })

    // Give it a moment and confirm no 30181
    await new Promise((resolve) => setTimeout(resolve, 100))
    const serviceRecord = (received as Array<Record<string, unknown>>).find(
      (m) => m.kind === 30181,
    )
    expect(serviceRecord).toBeUndefined()
    safeClose(client)
  })

  it('connects outbound to a peer URL', async () => {
    const p = nextPort()
    const server = new WebSocketServer({ port: p })
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    const received: string[] = []
    server.on('connection', (ws) => {
      ws.on('message', (data) => received.push(data.toString()))
    })

    pm = new PeerManager({ port: nextPort(), pubkey: 'a'.repeat(64), privkey: 'a'.repeat(64) })
    await pm.listen()
    pm.connect(`ws://127.0.0.1:${p}`)

    await waitFor(() => received.length > 0)
    expect(received[0]).toContain('handshake')
    server.close()
  })
})
