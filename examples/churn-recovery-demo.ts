import { Topology } from '../src/core/graph/topology.js'
import { Simulation } from '../src/sim/runner/simulation.js'
import { printReport } from '../src/sim/runner/report.js'

const simulation = new Simulation({
  nodes: 120,
  topology: Topology.barabasiAlbert({ n: 120, m: 3, seed: 42 }),
  gamma: 0.5,
  threshold: 0.25,
  tickCount: 180,
})

simulation.scheduleChurn('node-10', 40, 100)
simulation.scheduleChurn('node-24', 60, 120)
simulation.scheduleChurn('node-72', 90, 140)

simulation.publishAnnouncement({
  pubkey: simulation.nodes[0]!.id,
  qkey: 'churn-demo',
  hash: 'sha256-churn-demo',
  sizeBytes: 2 * 1024 * 1024,
  pieces: 8,
  pieceSize: 256 * 1024,
  ttl: 86400,
  name: 'churn-demo.bin',
}, 0)

simulation.metrics.setInterestedNodes('churn-demo', new Set(simulation.nodes.slice(1, 41).map((node) => node.id)))
await simulation.run()
printReport(simulation.report(['churn-demo']))
