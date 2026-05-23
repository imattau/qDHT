import { Topology } from '../../core/graph/topology.js'
import { buildAnnouncement } from '../../core/protocol/announcement.js'
import { printReport } from '../runner/report.js'
import { Simulation } from '../runner/simulation.js'

const simulation = new Simulation({
  nodes: 500,
  topology: Topology.barabasiAlbert({ n: 500, m: 3, seed: 42 }),
  gamma: 0.5,
  threshold: 0.25,
  tickCount: 400,
})

const spamNodes = simulation.nodes.slice(0, 50)
for (const spammer of spamNodes) {
  for (const node of simulation.nodes) {
    node.reputationMap.set(spammer.id, -0.9)
  }

  for (let index = 0; index < 20; index++) {
    const announcement = buildAnnouncement({
      pubkey: spammer.id,
      qkey: `spam-key-${index}`,
      hash: `bad-hash-${index}`,
      sizeBytes: 0,
      pieces: 1,
      pieceSize: 1,
      ttl: 3600,
    })
    for (const node of simulation.nodes) {
      if (node !== spammer) {
        node.inbox.enqueueFrom(spammer.id, announcement)
      }
    }
  }
}

simulation.publishAnnouncement({
  pubkey: simulation.nodes[100]!.id,
  qkey: 'content-legit-1',
  hash: 'sha256-legit-1',
  sizeBytes: 5 * 1024 * 1024,
  pieces: 20,
  pieceSize: 256 * 1024,
  ttl: 86400,
}, 0)

simulation.metrics.setInterestedNodes(
  'content-legit-1',
  new Set(simulation.nodes.slice(1, 201).map((node) => node.id)),
)

simulation.on('tick', (round: number) => {
  if (round % 100 === 0) {
    process.stdout.write(`  tick ${round}/400\r`)
  }
})

await simulation.run()
const report = simulation.report(['content-legit-1'])
printReport(report)
console.log(`\n  spam nodes: ${spamNodes.length} (reputation: -0.9)`)
