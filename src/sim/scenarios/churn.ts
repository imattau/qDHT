import { Topology } from '../../core/graph/topology.js'
import { printReport } from '../runner/report.js'
import { Simulation } from '../runner/simulation.js'

function makePrng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 4294967296
  }
}

const simulation = new Simulation({
  nodes: 500,
  topology: Topology.barabasiAlbert({ n: 500, m: 3, seed: 42 }),
  gamma: 0.5,
  threshold: 0.25,
  tickCount: 600,
})

const rand = makePrng(7)
const churnNodes = simulation.nodes.slice(1).filter(() => rand() < 0.2)
for (const node of churnNodes) {
  const offlineAt = Math.floor(rand() * 200) + 50
  simulation.scheduleChurn(node.id, offlineAt, offlineAt + 50)
}

simulation.publishAnnouncement({
  pubkey: simulation.nodes[0]!.id,
  qkey: 'content-churn-1',
  hash: 'sha256-churn-1',
  sizeBytes: 5 * 1024 * 1024,
  pieces: 20,
  pieceSize: 256 * 1024,
  ttl: 86400,
}, 0)

simulation.metrics.setInterestedNodes(
  'content-churn-1',
  new Set(simulation.nodes.slice(1, 201).map((node) => node.id)),
)

simulation.on('tick', (round: number) => {
  if (round % 100 === 0) {
    process.stdout.write(`  tick ${round}/600\r`)
  }
})

await simulation.run()
const report = simulation.report(['content-churn-1'])
printReport(report)
console.log(`\n  churned nodes: ${churnNodes.length}`)
