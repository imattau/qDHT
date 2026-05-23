import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GraphState } from '../core/graph/graph-state.js'
import { Propagator } from '../core/propagation/propagator.js'
import { NeighbourStateMap } from '../core/neighbour-state.js'
import { signAnnouncement } from '../core/identity/signing.js'
import { generateKeypair } from '../core/identity/keys.js'
import { buildAnnouncement } from '../core/protocol/announcement.js'
import { SyncManager } from './sync-manager.js'

function makeDeps() {
  const graph = new GraphState()
  graph.addNode('local')
  const propagator = new Propagator(graph, graph.getIndex('local'), 0.5)
  const neighbourState = new NeighbourStateMap()
  const broadcast = vi.fn()
  const send = vi.fn()
  const sm = new SyncManager({
    pubkey: 'a'.repeat(64),
    privkey: 'a'.repeat(64),
    propagator,
    neighbourState,
    broadcast,
    send,
  })
  return { sm, broadcast, send, neighbourState }
}

describe('SyncManager', () => {
  it('dispatches kind 10800 announcement: broadcasts to other peers', () => {
    const { sm, broadcast } = makeDeps()
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
    expect(broadcast).toHaveBeenCalledWith(signed, 'peer-b')
  })

  it('dispatches kind 20800 delta request: calls send with 20801 response', () => {
    const { sm, send } = makeDeps()
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
    expect(send).toHaveBeenCalledWith('peer-b', expect.objectContaining({ kind: 20801 }))
  })

  it('does not re-broadcast kind 20801 delta responses', () => {
    const { sm, broadcast } = makeDeps()
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
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('sendDeltaRequest sends kind 20800 to a peer', () => {
    const { sm, send } = makeDeps()
    sm.sendDeltaRequest('peer-b', 0)
    expect(send).toHaveBeenCalledWith('peer-b', expect.objectContaining({ kind: 20800 }))
  })

  it('publishAnnouncement broadcasts an announcement built from opts', () => {
    const { sm, broadcast } = makeDeps()
    sm.publishAnnouncement({
      qkey: 'qk1',
      hash: 'd'.repeat(64),
      sizeBytes: 200,
      pieces: 1,
      pieceSize: 512 * 1024,
      ttl: 3600,
    })
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ kind: 10800 }))
  })
})
