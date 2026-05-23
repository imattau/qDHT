import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GraphState } from '../core/graph/graph-state.js'
import { Propagator } from '../core/propagation/propagator.js'
import { NeighbourStateMap } from '../core/neighbour-state.js'
import { ReputationMap } from '../core/protocol/reputation.js'
import { signAnnouncement } from '../core/identity/signing.js'
import { generateKeypair } from '../core/identity/keys.js'
import { buildAnnouncement } from '../core/protocol/announcement.js'
import { buildRequestAnnouncement } from '../core/protocol/request.js'
import { buildRouteAnnouncement } from '../core/discovery/reachability.js'
import { signRouteAnnouncement } from '../core/discovery/reachability.js'
import { NostrSqliteStore } from '../core/nostr/sqlite-store.js'
import { SyncManager } from './sync-manager.js'
import type { Transport } from './transport.js'

function makeMockTransport(): Transport & {
  broadcasts: Array<{ msg: unknown; excludePeerId?: string }>
  sends: Array<{ peerId: string; msg: unknown }>
  triggerMessage(msg: unknown, peerId: string): void
  triggerConnected(peerId: string): void
  triggerDisconnected(peerId: string): void
} {
  let messageHandler: ((msg: unknown, peerId: string) => void) | null = null
  let connectedHandler: ((peerId: string) => void) | null = null
  let disconnectedHandler: ((peerId: string) => void) | null = null
  const broadcasts: Array<{ msg: unknown; excludePeerId?: string }> = []
  const sends: Array<{ peerId: string; msg: unknown }> = []

  return {
    broadcasts,
    sends,
    onMessage(handler) {
      messageHandler = handler
    },
    onPeerConnected(handler) {
      connectedHandler = handler
    },
    onPeerDisconnected(handler) {
      disconnectedHandler = handler
    },
    broadcast(msg, excludePeerId) {
      broadcasts.push({ msg, excludePeerId })
    },
    send(peerId, msg) {
      sends.push({ peerId, msg })
    },
    async close() {},
    triggerMessage(msg, peerId) {
      messageHandler?.(msg, peerId)
    },
    triggerConnected(peerId) {
      connectedHandler?.(peerId)
    },
    triggerDisconnected(peerId) {
      disconnectedHandler?.(peerId)
    },
  }
}

let tmpRoot = ''
const openStores: NostrSqliteStore[] = []

function makeDeps() {
  const eventStorePath = join(tmpRoot, 'qdht.sqlite')
  const eventStore = new NostrSqliteStore(eventStorePath)
  openStores.push(eventStore)
  const graph = new GraphState()
  graph.addNode('local')
  const propagator = new Propagator(graph, graph.getIndex('local'), 0.5)
  const neighbourState = new NeighbourStateMap()
  const transport = makeMockTransport()
  const reputationMap = new ReputationMap()
  const sm = new SyncManager({
    pubkey: 'a'.repeat(64),
    privkey: 'a'.repeat(64),
    propagator,
    neighbourState,
    reputationMap,
    eventStore,
    transports: [transport],
  })
  return { sm, transport, neighbourState, reputationMap, eventStore, eventStorePath }
}

describe('SyncManager', () => {
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'qdht-sync-manager-'))
  })

  afterEach(async () => {
    while (openStores.length > 0) {
      openStores.pop()?.close()
    }
    await rm(tmpRoot, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches kind 10800 announcement: broadcasts to all transports', () => {
    const { sm, transport } = makeDeps()
    const keypair = generateKeypair()
    const announcement = buildAnnouncement({
      pubkey: keypair.pubkey,
      qkey: 'q1',
      hash: 'h'.repeat(64),
      sizeBytes: 100,
      pieces: 1,
      pieceSize: 512 * 1024,
      ttl: 3600,
    })
    const signed = signAnnouncement(announcement, keypair.privkey)

    sm.handleMessage(signed, 'peer-b')
    expect(transport.broadcasts).toHaveLength(1)
    expect(transport.broadcasts[0]).toMatchObject({ msg: signed, excludePeerId: 'peer-b' })
  })

  it('dispatches kind 20800 delta request: sends 20801 response through transports', () => {
    const { sm, transport } = makeDeps()
    const deltaReq = {
      kind: 20800,
      pubkey: 'b'.repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      tags: [['since', '0'], ['limit', '100']],
      content: '',
      sig: '',
      id: 'req1',
    }

    sm.handleMessage(deltaReq, 'peer-b')
    expect(transport.sends.length).toBeGreaterThan(0)
    expect(transport.sends[0]!).toMatchObject({ peerId: 'peer-b' })
    expect(transport.sends[0]!.msg).toMatchObject({ kind: 20801 })
  })

  it('dispatches kind 10804 request announcement: records and broadcasts metadata-only requests', () => {
    const { sm, transport } = makeDeps()
    const keypair = generateKeypair()
    const request = buildRequestAnnouncement({
      pubkey: keypair.pubkey,
      type: 'content',
      query: 'guide.pdf',
      limit: 10,
      ttl: 300,
      mime: 'application/pdf',
    })

    sm.handleMessage({ ...request, id: 'req-10804' }, 'peer-b')
    expect(transport.broadcasts).toHaveLength(1)
    expect(transport.broadcasts[0]).toMatchObject({ excludePeerId: 'peer-b' })
    expect(transport.broadcasts[0]!.msg).toMatchObject({ kind: 10804 })
  })

  it('answers a request announcement with matching announcements and route records', () => {
    const { sm, transport } = makeDeps()
    const keypair = generateKeypair()
    const contentAnnouncement = buildAnnouncement({
      pubkey: keypair.pubkey,
      qkey: 'guide.pdf',
      hash: 'c'.repeat(64),
      sizeBytes: 1234,
      pieces: 1,
      pieceSize: 1234,
      ttl: 3600,
      name: 'guide.pdf',
    })
    const route = buildRouteAnnouncement(keypair.pubkey, [
      {
        subjectIdentity: keypair.pubkey,
        observerIdentity: 'b'.repeat(64),
        observedIp: '127.0.0.1',
        observedPort: 22010,
        transport: 'ws',
        observedAt: Math.floor(Date.now() / 1000),
        confidence: 0.9,
        dialbackSuccess: true,
      },
    ])

    sm.handleMessage(signAnnouncement(contentAnnouncement, keypair.privkey), 'peer-b')
    sm.handleMessage(signRouteAnnouncement(route, keypair.privkey), 'peer-b')
    transport.broadcasts.length = 0

    const request = buildRequestAnnouncement({
      pubkey: keypair.pubkey,
      type: 'content',
      query: 'guide.pdf',
      limit: 10,
      ttl: 300,
      qkey: 'guide.pdf',
      hash: 'c'.repeat(64),
    })

    sm.handleMessage({ ...request, id: 'req-content' }, 'peer-b')

    expect(transport.sends).toHaveLength(1)
    expect(transport.sends[0]!.peerId).toBe('peer-b')
    expect(transport.sends[0]!.msg).toMatchObject({ kind: 10805 })
    expect(JSON.parse(String((transport.sends[0]!.msg as { content: string }).content))).toMatchObject({
      requestId: 'req-content',
      requestType: 'content',
      query: 'guide.pdf',
      announcements: expect.any(Array),
      routes: expect.any(Array),
    })
  })

  it('searchRequest publishes a request and returns local matches', async () => {
    const { sm, transport } = makeDeps()
    const keypair = generateKeypair()
    const contentAnnouncement = buildAnnouncement({
      pubkey: keypair.pubkey,
      qkey: 'guide.pdf',
      hash: 'c'.repeat(64),
      sizeBytes: 1234,
      pieces: 1,
      pieceSize: 1234,
      ttl: 3600,
      name: 'guide.pdf',
    })
    sm.handleMessage(signAnnouncement(contentAnnouncement, keypair.privkey), 'peer-b')
    transport.broadcasts.length = 0

    const response = await sm.searchRequest({
      type: 'content',
      query: 'guide.pdf',
      limit: 10,
      ttl: 300,
      qkey: 'guide.pdf',
      hash: 'c'.repeat(64),
      name: 'guide.pdf',
    }, 100)

    expect(transport.broadcasts.some((entry) => entry.msg && typeof entry.msg === 'object' && (entry.msg as { kind?: number }).kind === 10804)).toBe(true)
    expect(response).not.toBeNull()
    expect(response?.requestType).toBe('content')
    expect(response?.announcements.length).toBeGreaterThan(0)
  })

  it('does not re-broadcast kind 20801 delta responses', () => {
    const { sm, transport } = makeDeps()
    const deltaResp = {
      kind: 20801,
      pubkey: 'b'.repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      tags: [['request', 'req1'], ['since', '0'], ['count', '0']],
      content: JSON.stringify({ announcements: [], replicas: [], reputationDeltas: [], expired: [] }),
      sig: '',
      id: 'resp1',
    }

    sm.handleMessage(deltaResp, 'peer-b')
    expect(transport.broadcasts).toHaveLength(0)
  })

  it('sendDeltaRequest sends kind 20800 to a peer through every transport', () => {
    const t1 = makeMockTransport()
    const t2 = makeMockTransport()
    const eventStore = new NostrSqliteStore(join(tmpRoot, 'delta-request.sqlite'))
    const graph = new GraphState()
    graph.addNode('local')
    const sm = new SyncManager({
      pubkey: 'a'.repeat(64),
      privkey: 'a'.repeat(64),
      propagator: new Propagator(graph, graph.getIndex('local'), 0.5),
      neighbourState: new NeighbourStateMap(),
      reputationMap: new ReputationMap(),
      eventStore,
      transports: [t1, t2],
    })

    sm.sendDeltaRequest('peer-b', 0)
    expect(t1.sends).toHaveLength(1)
    expect(t2.sends).toHaveLength(1)
    expect(t1.sends[0]!.msg).toMatchObject({ kind: 20800 })
    expect(t2.sends[0]!.msg).toMatchObject({ kind: 20800 })
    sm.close()
    eventStore.close()
  })

  it('publishes announcements through every transport', () => {
    const t1 = makeMockTransport()
    const t2 = makeMockTransport()
    const eventStore = new NostrSqliteStore(join(tmpRoot, 'publish.sqlite'))
    const graph = new GraphState()
    graph.addNode('local')
    const sm = new SyncManager({
      pubkey: 'a'.repeat(64),
      privkey: 'a'.repeat(64),
      propagator: new Propagator(graph, graph.getIndex('local'), 0.5),
      neighbourState: new NeighbourStateMap(),
      reputationMap: new ReputationMap(),
      eventStore,
      transports: [t1, t2],
    })

    sm.publishAnnouncement({
      qkey: 'qk1',
      hash: 'd'.repeat(64),
      sizeBytes: 200,
      pieces: 1,
      pieceSize: 512 * 1024,
      ttl: 3600,
    })

    expect(t1.broadcasts.length).toBeGreaterThan(0)
    expect(t2.broadcasts.length).toBeGreaterThan(0)
    sm.close()
    eventStore.close()
  })

  it('sends a delta request when a transport reports a peer connection', () => {
    const { sm, transport } = makeDeps()

    transport.triggerConnected('peer-b')

    expect(transport.sends.length).toBeGreaterThan(0)
    expect(transport.sends[0]!.peerId).toBe('peer-b')
    expect(transport.sends[0]!.msg).toMatchObject({ kind: 20800 })
  })

  it('hydrates announcements from the sqlite event store', () => {
    const { sm, eventStorePath } = makeDeps()
    const keypair = generateKeypair()
    const announcement = buildAnnouncement({
      pubkey: keypair.pubkey,
      qkey: 'persisted-qkey',
      hash: 'c'.repeat(64),
      sizeBytes: 123,
      pieces: 1,
      pieceSize: 123,
      ttl: 3600,
    })
    const signed = signAnnouncement(announcement, keypair.privkey)

    sm.handleMessage(signed, 'peer-b')
    sm.close()

    const graph = new GraphState()
    graph.addNode('local')
    const reloadedStore = new NostrSqliteStore(eventStorePath)
    const reloaded = new SyncManager({
      pubkey: 'a'.repeat(64),
      privkey: 'a'.repeat(64),
      propagator: new Propagator(graph, graph.getIndex('local'), 0.5),
      neighbourState: new NeighbourStateMap(),
      reputationMap: new ReputationMap(),
      eventStore: reloadedStore,
      transports: [makeMockTransport()],
    })

    expect(reloaded.getAnnouncementInfo('persisted-qkey')).toMatchObject({
      hash: 'c'.repeat(64),
      totalPieces: 1,
      pieceSize: 123,
    })
    reloaded.close()
    reloadedStore.close()
  })
})
