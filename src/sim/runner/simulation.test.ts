import { describe, expect, it } from 'vitest'
import { Topology } from '../../core/graph/topology.js'
import { Simulation } from './simulation.js'

describe('Simulation', () => {
  it('runs without error and advances ticks', async () => {
    const simulation = new Simulation({
      nodes: 10,
      topology: Topology.erdosRenyi({ n: 10, p: 0.4, seed: 1 }),
      gamma: 0.5,
      threshold: 0.3,
      tickCount: 5,
    })

    let ticksFired = 0
    simulation.on('tick', () => {
      ticksFired += 1
    })

    await simulation.run()
    expect(ticksFired).toBe(5)
  })

  it('propagates an announcement to multiple nodes', async () => {
    const simulation = new Simulation({
      nodes: 20,
      topology: Topology.erdosRenyi({ n: 20, p: 0.5, seed: 2 }),
      gamma: 0.5,
      threshold: 0.1,
      tickCount: 50,
    })

    simulation.publishAnnouncement({
      pubkey: simulation.nodes[0]!.id,
      qkey: 'test-key',
      hash: 'test-hash',
      sizeBytes: 1024,
      pieces: 1,
      pieceSize: 1024,
      ttl: 9999,
    }, 0)

    await simulation.run()
    const report = simulation.report(['test-key'])

    expect(report.totalAnnouncementBandwidth).toBeGreaterThan(0)
  })
})
