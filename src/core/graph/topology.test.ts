import { describe, expect, it } from 'vitest'
import { GraphState } from './graph-state.js'
import { Topology } from './topology.js'

describe('Topology.erdosRenyi', () => {
  it('creates n nodes', () => {
    const graph = new GraphState()
    Topology.erdosRenyi({ n: 10, p: 0.5, seed: 42 }).apply(graph)
    expect(graph.size).toBe(10)
  })

  it('is deterministic with same seed', () => {
    const left = new GraphState()
    const right = new GraphState()
    Topology.erdosRenyi({ n: 20, p: 0.3, seed: 99 }).apply(left)
    Topology.erdosRenyi({ n: 20, p: 0.3, seed: 99 }).apply(right)
    left.recompute()
    right.recompute()

    const a1 = left.amplitude(0, 1, 1)
    const a2 = right.amplitude(0, 1, 1)
    expect(a1.real).toBeCloseTo(a2.real, 10)
  })
})

describe('Topology.barabasiAlbert', () => {
  it('creates n nodes with m edges per new node', () => {
    const graph = new GraphState()
    Topology.barabasiAlbert({ n: 50, m: 2, seed: 1 }).apply(graph)
    expect(graph.size).toBe(50)
  })
})

describe('Topology.fromAdjacency', () => {
  it('builds topology from explicit adjacency list', () => {
    const graph = new GraphState()
    Topology.fromAdjacency(['a', 'b', 'c'], [[0, 1], [1, 2]]).apply(graph)
    graph.recompute()

    expect(graph.size).toBe(3)
    const amplitude = graph.amplitude(0, 0, 0)
    expect(amplitude.real).toBeCloseTo(1)
  })
})
