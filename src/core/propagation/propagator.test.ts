import { describe, expect, it } from 'vitest'
import { GraphState } from '../graph/graph-state.js'
import { Topology } from '../graph/topology.js'
import { Propagator } from './propagator.js'

function makeGraph(n: number): GraphState {
  const graph = new GraphState()
  Topology.erdosRenyi({ n, p: 0.3, seed: 1 }).apply(graph)
  graph.recompute()
  return graph
}

describe('Propagator', () => {
  it('accepts a note and tracks it', () => {
    const graph = makeGraph(10)
    const propagator = new Propagator(graph, 0, 0.5)
    propagator.addNote('note-1', 'src-node', 'pubkey-a', 0)
    expect(propagator.activeCount()).toBe(1)
    expect(propagator.hasNote('note-1')).toBe(true)
  })

  it('does not duplicate notes', () => {
    const graph = makeGraph(10)
    const propagator = new Propagator(graph, 0, 0.5)
    propagator.addNote('note-1', 'src', 'pk', 0)
    propagator.addNote('note-1', 'src', 'pk', 0)
    expect(propagator.activeCount()).toBe(1)
  })

  it('triggers fetch when probability exceeds threshold', () => {
    const graph = new GraphState()
    Topology.fromAdjacency(['a'], []).apply(graph)
    graph.recompute()

    const fetched: string[] = []
    const propagator = new Propagator(graph, 0, 0.01, (id) => fetched.push(id))
    propagator.addNote('note-x', 'a', 'pk', 0)
    propagator.tick(1, 0)
    expect(fetched).toContain('note-x')
    expect(propagator.activeCount()).toBe(0)
  })

  it('applies exploration floor for old notes', () => {
    const graph = new GraphState()
    Topology.fromAdjacency(['a', 'b'], []).apply(graph)
    graph.recompute()

    const fetched: string[] = []
    const propagator = new Propagator(graph, 0, 0.01, (id) => fetched.push(id))
    propagator.addNote('note-y', 'b', 'pk', 0)
    for (let round = 1; round <= 200; round++) {
      propagator.tick(round, 0)
    }
    expect(fetched).toContain('note-y')
  })
})
