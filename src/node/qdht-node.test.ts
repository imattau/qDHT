import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConnection } from 'node:net'
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
})
