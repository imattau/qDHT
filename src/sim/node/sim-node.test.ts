import { describe, expect, it } from 'vitest'
import { GraphState } from '../../core/graph/graph-state.js'
import { Topology } from '../../core/graph/topology.js'
import { Inbox } from './inbox.js'
import { SimNode } from './sim-node.js'

describe('Inbox', () => {
  it('serialises and deserialises messages through JSON round-trip', () => {
    const inbox = new Inbox()
    const message = { kind: 10800, pubkey: 'pk1', data: { nested: true } }
    inbox.enqueue(message)

    const received = inbox.drain()
    expect(received).toHaveLength(1)
    expect(received[0]).not.toBe(message)
    expect(received[0]).toEqual(message)
  })

  it('drops messages when offline', () => {
    const inbox = new Inbox()
    inbox.setOnline(false)
    inbox.enqueue({ kind: 10800 })
    expect(inbox.drain()).toHaveLength(0)
  })
})

describe('SimNode', () => {
  it('creates node with id and online state', () => {
    const graph = new GraphState()
    Topology.fromAdjacency(['a', 'b'], [[0, 1]]).apply(graph)
    graph.recompute()

    const node = new SimNode('node-0', 0, graph, 0.5)
    expect(node.id).toBe('node-0')
    expect(node.online).toBe(true)
  })

  it('records neighbour state on announcement receive', () => {
    const graph = new GraphState()
    Topology.fromAdjacency(['a', 'b'], [[0, 1]]).apply(graph)
    graph.recompute()

    const node = new SimNode('node-0', 0, graph, 0.5)
    node.receiveAnnouncement(
      {
        kind: 10800,
        pubkey: 'node-1',
        created_at: 0,
        sig: '',
        tags: [
          ['qkey', 'k1'],
          ['hash', 'h1'],
          ['size', '100'],
          ['pieces', '1'],
          ['piece_size', '100'],
          ['ttl', '3600'],
        ],
        content: '',
      },
      'node-1',
      1,
    )

    expect(node.neighbourState.get('k1')).toBeDefined()
  })
})
