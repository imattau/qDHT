import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { signEvent } from '../core/identity/signing.js'
import { QDHT_KIND } from '../core/nostr/kinds.js'
import { createConnection, createServer } from 'node:net'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { QDHTNode } from './qdht-node.js'
import type { QDHTConfig } from './config.js'
import { generateKeypair } from '../core/identity/keys.js'
import { NostrSqliteStore } from '../core/nostr/sqlite-store.js'
import { buildRouteAnnouncement, signRouteAnnouncement } from '../core/discovery/reachability.js'
import { MemoryNodeStorage } from '../core/storage/memory-node-storage.js'

let tmpDir = ''
let node: QDHTNode | undefined

async function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

async function rpc(sockPath: string, request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const conn = createConnection(sockPath)
    let buf = ''
    const timer = setTimeout(() => {
      conn.destroy()
      reject(new Error('rpc timeout'))
    }, 2000)

    conn.on('connect', () => conn.write(`${JSON.stringify(request)}\n`))
    conn.on('data', (d) => {
      buf += d.toString()
      if (buf.includes('\n')) {
        clearTimeout(timer)
        conn.destroy()
        try {
          resolve(JSON.parse(buf.trim()))
        } catch {
          reject(new Error(`bad JSON: ${buf}`))
        }
      }
    })
    conn.on('error', reject)
  })
}

async function occupyPort(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer()
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address) {
        resolve(address.port)
      } else {
        reject(new Error('failed to bind test port'))
      }
    })
  })
  return { server, port }
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qdht-node-'))
})

afterEach(async () => {
  await node?.stop()
  await rm(tmpDir, { recursive: true, force: true })
  node = undefined
})

describe('QDHTNode', () => {
  it('starts and reports peers via RPC', async () => {
    const config: QDHTConfig = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 19900,
      dataDir: tmpDir,
    }
    node = new QDHTNode(config)
    await node.start()

    const sockPath = join(tmpDir, 'qdht.sock')
    await waitFor(() => node!.peerCount() === 0)

    const resp = await rpc(sockPath, { cmd: 'peers' }) as { peers: unknown[] }
    expect(resp).toMatchObject({ peers: [] })
  })

  it('stores content and reports replicas via RPC', async () => {
    const config: QDHTConfig = {
      identity: { privkey: 'b'.repeat(64) },
      peers: [],
      port: 19901,
      dataDir: tmpDir,
    }
    node = new QDHTNode(config)
    await node.start()

    const loc = await node.put(Buffer.from('hello qdht'), { name: 'hello.txt', ttl: 3600 })
    const sockPath = join(tmpDir, 'qdht.sock')

    const resp = await rpc(sockPath, { cmd: 'replicas', key: loc.qkey }) as { replicas: unknown[] }
    expect(Array.isArray(resp.replicas)).toBe(true)
  })

  it('returns locally stored content via fetchContent()', async () => {
    const config: QDHTConfig = {
      identity: { privkey: 'c'.repeat(64) },
      peers: [],
      port: 19902,
      dataDir: tmpDir,
    }
    node = new QDHTNode(config)
    await node.start()

    const original = Buffer.from('local qdht content')
    const loc = await node.put(original, { name: 'local.txt', ttl: 3600 })
    const fetched = await node.fetchContent(loc.qkey)

    expect(fetched.equals(original)).toBe(true)
  })

  it('searches local route announcements by identity', async () => {
    const subject = generateKeypair()
    const observer = generateKeypair()
    const dbPath = join(tmpDir, 'qdht.sqlite')
    const store = new NostrSqliteStore(dbPath)
    const route = buildRouteAnnouncement(subject.pubkey, [
      {
        subjectIdentity: subject.pubkey,
        observerIdentity: observer.pubkey,
        observedIp: '127.0.0.1',
        observedPort: 22000,
        transport: 'ws',
        observedAt: 1710000000,
        confidence: 0.95,
        dialbackSuccess: true,
      },
    ])
    store.upsert(signRouteAnnouncement(route, subject.privkey))
    store.close()

    const config: QDHTConfig = {
      identity: { privkey: 'd'.repeat(64) },
      peers: [],
      port: 19903,
      dataDir: tmpDir,
    }
    node = new QDHTNode(config)
    await node.start()

    const resolved = await node.searchIdentity(subject.pubkey)
    expect(resolved).not.toBeNull()
    expect(resolved?.bestEndpoint).toMatchObject({
      transport: 'ws',
      address: '127.0.0.1',
      port: 22000,
    })
  })

  it('searches local announcements with the request path', async () => {
    const config: QDHTConfig = {
      identity: { privkey: 'e'.repeat(64) },
      peers: [],
      port: 19904,
      dataDir: tmpDir,
    }
    node = new QDHTNode(config)
    await node.start()

    const loc = await node.put(Buffer.from('searchable qdht content'), { name: 'guide.pdf', ttl: 3600 })
    const response = await node.searchAnnouncements('guide.pdf', {
      type: 'content',
      limit: 10,
      timeoutMs: 500,
      qkey: loc.qkey,
      hash: loc.hash,
      name: 'guide.pdf',
      mime: 'application/pdf',
    })

    expect(response).not.toBeNull()
    expect(response?.requestType).toBe('content')
    expect(response?.announcements.length).toBeGreaterThan(0)
    expect(JSON.parse(response?.announcements[0] ?? '{}')).toMatchObject({
      kind: 10800,
      pubkey: node!.pubkey(),
    })
  })

  it('can run on injected memory storage', async () => {
    const storage = new MemoryNodeStorage()
    const keypair = generateKeypair()
    const config: QDHTConfig = {
      identity: { privkey: keypair.privkey },
      peers: [],
      port: 19905,
      dataDir: tmpDir,
    }
    node = new QDHTNode(config, storage)
    await node.start()

    const original = Buffer.from('memory-backed qdht content')
    const loc = await node.put(original, { name: 'memory.txt', ttl: 3600 })
    const fetched = await node.fetchContent(loc.qkey)

    expect(fetched.equals(original)).toBe(true)
    await node.stop()
    node = undefined
  })

  it('falls back to the next free listen port when the configured port is occupied', async () => {
    const occupied = await occupyPort()
    const keypair = generateKeypair()
    const config: QDHTConfig = {
      identity: { privkey: keypair.privkey },
      peers: [],
      port: occupied.port,
      dataDir: tmpDir,
    }

    node = new QDHTNode(config)
    await node.start()

    expect(node.listenPort()).toBeGreaterThan(occupied.port)
    await new Promise<void>((resolve) => occupied.server.close(() => resolve()))
  })
})

describe('QDHTNode bootstrapMode', () => {
  let bootstrapNode: QDHTNode | undefined
  let bsTmpDir: string

  beforeEach(async () => {
    bsTmpDir = await mkdtemp(join(tmpdir(), 'qdht-bs-'))
  })

  afterEach(async () => {
    await bootstrapNode?.stop()
    bootstrapNode = undefined
    await rm(bsTmpDir, { recursive: true, force: true })
  })

  it('starts in bootstrap mode without error', async () => {
    const kp = generateKeypair()
    bootstrapNode = new QDHTNode(
      {
        identity: { privkey: kp.privkey },
        peers: [],
        port: 0,
        dataDir: bsTmpDir,
        bootstrapMode: true,
        maxPeers: 100,
      },
      new MemoryNodeStorage(),
    )
    await bootstrapNode.start()
    expect(bootstrapNode.listenPort()).toBeGreaterThan(0)
  })

  it('caches and fans out 30181 events received from peers', async () => {
    const nodeKp = generateKeypair()
    bootstrapNode = new QDHTNode(
      {
        identity: { privkey: nodeKp.privkey },
        peers: [],
        port: 0,
        dataDir: bsTmpDir,
        bootstrapMode: true,
      },
      new MemoryNodeStorage(),
    )
    await bootstrapNode.start()
    const port = bootstrapNode.listenPort()

    const peer1Kp = generateKeypair()
    const peer2Kp = generateKeypair()

    const peer1 = new WebSocket(`ws://127.0.0.1:${port}`)
    const peer2 = new WebSocket(`ws://127.0.0.1:${port}`)

    const peer2Received: unknown[] = []
    peer2.on('message', (data: import('ws').RawData) => {
      peer2Received.push(JSON.parse(data.toString()))
    })

    async function doHandshake(ws: WebSocket, pubkey: string): Promise<void> {
      await new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'handshake', pubkey }))
          resolve()
          return
        }
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'handshake', pubkey }))
          resolve()
        })
      })
    }

    function wait(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    async function waitForCondition(fn: () => boolean, timeoutMs = 3000): Promise<void> {
      const start = Date.now()
      while (!fn()) {
        if (Date.now() - start > timeoutMs) throw new Error('timeout')
        await wait(20)
      }
    }

    await doHandshake(peer1, peer1Kp.pubkey)
    await doHandshake(peer2, peer2Kp.pubkey)
    await wait(100)

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
    peer1.send(JSON.stringify(record))

    await waitForCondition(
      () =>
        (peer2Received as Array<Record<string, unknown>>).some(
          (m) => m.kind === QDHT_KIND.SERVICE_RECORD && m.pubkey === peer1Kp.pubkey,
        ),
    )

    peer1.close()
    peer2.close()
  })
})
