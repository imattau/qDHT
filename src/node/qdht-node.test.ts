import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { QDHTNode } from './qdht-node.js'
import type { QDHTConfig } from './config.js'

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
})
