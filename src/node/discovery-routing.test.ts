import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QDHTNode } from './qdht-node.js'
import { generateKeypair } from '../core/identity/keys.js'
import { NostrSqliteStore } from '../core/nostr/sqlite-store.js'
import { buildRouteAnnouncement, signRouteAnnouncement } from '../core/discovery/reachability.js'

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
  tmpRoot = await mkdtemp(join(tmpdir(), 'qdht-discovery-'))
})

afterEach(async () => {
  await nodeB?.stop()
  await nodeA?.stop()
  await rm(tmpRoot, { recursive: true, force: true })
  nodeA = undefined
  nodeB = undefined
})

describe('discovery routing', () => {
  it('dials a pubkey peer reference via a stored route announcement', async () => {
    const dirA = join(tmpRoot, 'a')
    const dirB = join(tmpRoot, 'b')
    const keyA = generateKeypair()
    const keyB = generateKeypair()

    const configA = {
      identity: { privkey: keyA.privkey },
      peers: [],
      port: 22010,
      dataDir: dirA,
    }

    const routeStore = new NostrSqliteStore(join(dirB, 'qdht.sqlite'))
    const route = buildRouteAnnouncement(keyA.pubkey, [
      {
        subjectIdentity: keyA.pubkey,
        observerIdentity: keyB.pubkey,
        observedIp: '127.0.0.1',
        observedPort: 22010,
        transport: 'ws',
        observedAt: 1710000100,
        confidence: 0.9,
        dialbackSuccess: true,
      },
    ])
    routeStore.upsert(signRouteAnnouncement(route, keyA.privkey))
    routeStore.close()

    const configB = {
      identity: { privkey: keyB.privkey },
      peers: [`nostr://${keyA.pubkey}`],
      port: 22011,
      dataDir: dirB,
    }

    nodeA = new QDHTNode(configA)
    nodeB = new QDHTNode(configB)

    const a = nodeA
    const b = nodeB
    await a.start()
    await b.start()

    await waitFor(() => a.peerCount() > 0 && b.peerCount() > 0)
    expect(a.peerCount()).toBeGreaterThan(0)
    expect(b.peerCount()).toBeGreaterThan(0)
  }, 20_000)
})
