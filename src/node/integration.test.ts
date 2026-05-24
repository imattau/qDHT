import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QDHTNode } from './qdht-node.js'
import type { QDHTConfig } from './config.js'

let dirA = ''
let dirB = ''
let nodeA: QDHTNode | undefined
let nodeB: QDHTNode | undefined

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timeout waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

beforeEach(async () => {
  dirA = await mkdtemp(join(tmpdir(), 'qdht-int-a-'))
  dirB = await mkdtemp(join(tmpdir(), 'qdht-int-b-'))
})

afterEach(async () => {
  await Promise.race([
    Promise.all([
      nodeA?.stop() ?? Promise.resolve(),
      nodeB?.stop() ?? Promise.resolve(),
    ]),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ])
  await rm(dirA, { recursive: true, force: true })
  await rm(dirB, { recursive: true, force: true })
  nodeA = undefined
  nodeB = undefined
})

describe('two-node integration', () => {
  it('node B receives announcement published by node A', async () => {
    const cfgA: QDHTConfig = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 19950,
      dataDir: dirA,
    }
    const cfgB: QDHTConfig = {
      identity: { privkey: 'b'.repeat(64) },
      peers: ['ws://127.0.0.1:19950'],
      port: 19951,
      dataDir: dirB,
    }

    nodeA = new QDHTNode(cfgA)
    await nodeA.start()

    nodeB = new QDHTNode(cfgB)
    await nodeB.start()

    await waitFor(() => nodeA!.peerCount() > 0)

    const loc = await nodeA.put(Buffer.from('hello from A'), { name: 'a.txt', ttl: 3600 })
    await waitFor(() => nodeB!.hasReceivedKey(loc.qkey), 5000)

    expect(nodeB.hasReceivedKey(loc.qkey)).toBe(true)
  }, 15_000)
})
