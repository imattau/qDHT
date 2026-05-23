import { describe, expect, it } from 'vitest'
import { NeighbourStateMap } from './neighbour-state.js'

describe('NeighbourStateMap', () => {
  it('records inbound neighbour on announcement receive', () => {
    const map = new NeighbourStateMap()
    map.recordInbound('key1', 'hash1', 'ann-id-1', 'node-A', 10)
    const state = map.get('key1')

    expect(state).toBeDefined()
    expect(state!.inbound.has('node-A')).toBe(true)
    expect(state!.inbound.get('node-A')!.probability).toBeCloseTo(1)
  })

  it('records outbound propagation', () => {
    const map = new NeighbourStateMap()
    map.recordOutbound('key1', 'hash1', 'ann-id-1', 'node-B', 10)
    expect(map.get('key1')!.outbound.has('node-B')).toBe(true)
  })

  it('updates replica availability', () => {
    const map = new NeighbourStateMap()
    map.recordInbound('key1', 'hash1', 'ann-1', 'node-A', 5)
    map.updateReplica('key1', 'node-A', true, [[0, 9]])
    const neighbour = map.get('key1')!.inbound.get('node-A')!

    expect(neighbour.hasReplica).toBe(true)
    expect(neighbour.pieceRanges).toEqual([[0, 9]])
  })

  it('returns best replica neighbour', () => {
    const map = new NeighbourStateMap()
    map.recordInbound('key1', 'hash1', 'ann-1', 'node-A', 1)
    map.recordInbound('key1', 'hash1', 'ann-1', 'node-B', 1)
    map.updateReplica('key1', 'node-B', true, [])
    expect(map.bestReplicaNeighbour('key1')).toBe('node-B')
  })
})
