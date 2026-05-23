import { describe, expect, it } from 'vitest'
import { GraphState } from './graph-state.js'

describe('GraphState', () => {
  it('returns amplitude 1 at source when t=0', () => {
    const graph = new GraphState()
    graph.setNodes(['a', 'b', 'c'])
    graph.setConnection('a', 'b', true)
    graph.setConnection('b', 'c', true)
    graph.recompute()

    const amplitude = graph.amplitude(0, 0, 0)
    expect(amplitude.real).toBeCloseTo(1)
    expect(amplitude.imag).toBeCloseTo(0)
  })

  it('returns amplitude 0 between different nodes at t=0', () => {
    const graph = new GraphState()
    graph.setNodes(['a', 'b'])
    graph.setConnection('a', 'b', true)
    graph.recompute()

    const amplitude = graph.amplitude(0, 1, 0)
    expect(amplitude.real).toBeCloseTo(0)
    expect(amplitude.imag).toBeCloseTo(0)
  })

  it('probability sums to roughly 1 across all nodes at any t', () => {
    const graph = new GraphState()
    graph.setNodes(['a', 'b', 'c', 'd'])
    graph.setConnection('a', 'b', true)
    graph.setConnection('b', 'c', true)
    graph.setConnection('c', 'd', true)
    graph.recompute()

    let total = 0
    for (let index = 0; index < 4; index++) {
      const amplitude = graph.amplitude(index, 0, 5)
      total += amplitude.real * amplitude.real + amplitude.imag * amplitude.imag
    }

    expect(total).toBeCloseTo(1, 2)
  })

  it('uses sparse path for graphs larger than 128 nodes', () => {
    const graph = new GraphState()
    const nodes = Array.from({ length: 130 }, (_, index) => `n${index}`)
    graph.setNodes(nodes)
    for (let index = 0; index < 129; index++) {
      graph.setConnection(`n${index}`, `n${index + 1}`, true)
    }
    graph.recompute()

    const amplitude = graph.amplitude(0, 0, 1)
    expect(typeof amplitude.real).toBe('number')
  })
})
