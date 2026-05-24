import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QDHTNode } from './qdht-node.js'
import type { QDHTConfig } from './config.js'

let tmpDir = ''
let node: QDHTNode | undefined
let occupiedServer: ReturnType<typeof createServer> | undefined

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qdht-web-'))
})

afterEach(async () => {
  await node?.stop()
  if (occupiedServer) {
    await new Promise<void>((resolve) => occupiedServer?.close(() => resolve()))
    occupiedServer = undefined
  }
  await rm(tmpDir, { recursive: true, force: true })
  node = undefined
})

describe('QDHT web frontend', () => {
  it('serves the dashboard and API endpoints', async () => {
    const config: QDHTConfig = {
      identity: { privkey: '1'.repeat(64) },
      peers: [],
      port: 19960,
      webPort: 0,
      dataDir: tmpDir,
    }

    node = new QDHTNode(config)
    await node.start()

    const webPort = node.webPort()
    if (webPort === null) {
      throw new Error('web server did not start')
    }
    const base = `http://127.0.0.1:${webPort}`

    const root = await fetch(`${base}/`)
    expect(root.ok).toBe(true)
    const html = await root.text()
    expect(html).toContain('qDHT web node')
    expect(html).toContain('Simulate network')

    const status = await fetch(`${base}/api/status`).then(async (response) => await response.json()) as {
      pubkey: string
      port: number
      webPort: number
      peerCount: number
    }
    expect(status.pubkey).toHaveLength(64)
    expect(status.port).toBe(19960)
    expect(status.webPort).toBe(webPort)
    expect(status.peerCount).toBe(0)

    const put = await fetch(`${base}/api/put`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'web.txt',
        ttl: 3600,
        mime: 'text/plain',
        dataBase64: Buffer.from('web qdht content').toString('base64'),
      }),
    }).then(async (response) => await response.json()) as {
      location: { qkey: string; hash: string }
    }
    expect(put.location.qkey).toMatch(/^[0-9a-f]{64}$/i)

    const content = await fetch(`${base}/api/content?key=${put.location.qkey}`).then(async (response) => await response.json()) as {
      found: boolean
      text?: string
      mime?: string
      announcement?: { name?: string }
    }
    expect(content.found).toBe(true)
    expect(content.text).toBe('web qdht content')
    expect(content.mime).toBe('text/plain')
    expect(content.announcement?.name).toBe('web.txt')

    const search = await fetch(`${base}/api/search?${new URLSearchParams({
      query: 'web.txt',
      type: 'content',
      qkey: put.location.qkey,
      name: 'web.txt',
      limit: '10',
    }).toString()}`).then(async (response) => await response.json()) as {
      response: {
        requestType: string
        announcements: string[]
      } | null
    }
    expect(search.response?.requestType).toBe('content')
    expect(search.response?.announcements.length).toBeGreaterThan(0)
  }, 20_000)

  it('falls back to the next free web port when the configured port is occupied', async () => {
    occupiedServer = createServer()
    const occupiedPort = await new Promise<number>((resolve, reject) => {
      occupiedServer?.once('error', reject)
      occupiedServer?.listen(0, '127.0.0.1', () => {
        const address = occupiedServer?.address()
        if (typeof address === 'object' && address) {
          resolve(address.port)
        } else {
          reject(new Error('failed to bind occupied port'))
        }
      })
    })

    const config: QDHTConfig = {
      identity: { privkey: '2'.repeat(64) },
      peers: [],
      port: 19961,
      webPort: occupiedPort,
      dataDir: tmpDir,
    }

    node = new QDHTNode(config)
    await node.start()

    const webPort = node.webPort()
    if (webPort === null) {
      throw new Error('web server did not start')
    }
    expect(webPort).toBeGreaterThan(occupiedPort)

    const root = await fetch(`http://127.0.0.1:${webPort}/`)
    expect(root.ok).toBe(true)
  }, 20_000)
})
