import { Topology } from '../../core/graph/topology.js'
import { buildReport, printReport } from '../runner/report.js'
import { Simulation } from '../runner/simulation.js'

const simulation = new Simulation({
  nodes: 500,
  topology: Topology.barabasiAlbert({ n: 500, m: 3, seed: 42 }),
  gamma: 0.5,
  threshold: 0.25,
  tickCount: 500,
})

const sourceId = simulation.nodes[0]!.id
simulation.publishAnnouncement({
  pubkey: sourceId,
  qkey: 'content-stable-1',
  hash: 'sha256-stable-1',
  sizeBytes: 10 * 1024 * 1024,
  pieces: 40,
  pieceSize: 256 * 1024,
  ttl: 86400,
  name: 'stable-test.bin',
}, 0)

const interested = new Set(simulation.nodes.slice(1, 201).map((node) => node.id))
simulation.metrics.setInterestedNodes('content-stable-1', interested)

simulation.on('tick', (round: number) => {
  if (round % 100 === 0) {
    process.stdout.write(`  tick ${round}/500\r`)
  }
})

await simulation.run()
const report = simulation.report(['content-stable-1'])
printReport(report)
