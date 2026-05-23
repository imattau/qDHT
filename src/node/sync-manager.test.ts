import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GraphState } from '../core/graph/graph-state.js'
import { Propagator } from '../core/propagation/propagator.js'
import { NeighbourStateMap } from '../core/neighbour-state.js'
import { signAnnouncement } from '../core/identity/signing.js'
import { generateKeypair } from '../core/identity/keys.js'
import { buildAnnouncement } from '../core/protocol/announcement.js'
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

function makeDeps() {
  const graph = new GraphState()
  graph.addNode('local')
  const propagator = new Propagator(graph, graph.getIndex('local'), 0.5)
  const neighbourState = new NeighbourStateMap()
  const transport = makeMockTransport()
  const sm = new SyncManager({
    pubkey: 'a'.repeat(64),
    privkey: 'a'.repeat(64),
    propagator,
    neighbourState,
    transports: [transport],
  })
  return { sm, transport, neighbourState }
}

describe('SyncManager', () => {
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
    const graph = new GraphState()
    graph.addNode('local')
    const sm = new SyncManager({
      pubkey: 'a'.repeat(64),
      privkey: 'a'.repeat(64),
      propagator: new Propagator(graph, graph.getIndex('local'), 0.5),
      neighbourState: new NeighbourStateMap(),
      transports: [t1, t2],
    })

    sm.sendDeltaRequest('peer-b', 0)
    expect(t1.sends).toHaveLength(1)
    expect(t2.sends).toHaveLength(1)
    expect(t1.sends[0]!.msg).toMatchObject({ kind: 20800 })
    expect(t2.sends[0]!.msg).toMatchObject({ kind: 20800 })
  })

  it('publishes announcements through every transport', () => {
    const t1 = makeMockTransport()
    const t2 = makeMockTransport()
    const graph = new GraphState()
    graph.addNode('local')
    const sm = new SyncManager({
      pubkey: 'a'.repeat(64),
      privkey: 'a'.repeat(64),
      propagator: new Propagator(graph, graph.getIndex('local'), 0.5),
      neighbourState: new NeighbourStateMap(),
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
  })

  it('sends a delta request when a transport reports a peer connection', () => {
    const { sm, transport } = makeDeps()

    transport.triggerConnected('peer-b')

    expect(transport.sends.length).toBeGreaterThan(0)
    expect(transport.sends[0]!.peerId).toBe('peer-b')
    expect(transport.sends[0]!.msg).toMatchObject({ kind: 20800 })
  })
})
