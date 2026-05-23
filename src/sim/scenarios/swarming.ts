import { selectPiecesToFetch } from '../../core/content/piece-fetcher.js'
import { Topology } from '../../core/graph/topology.js'
import { printReport } from '../runner/report.js'
import { Simulation } from '../runner/simulation.js'

const TOTAL_PIECES = 512
const PIECE_SIZE = 400 * 1024

const simulation = new Simulation({
  nodes: 500,
  topology: Topology.barabasiAlbert({ n: 500, m: 3, seed: 42 }),
  gamma: 0.5,
  threshold: 0.25,
  tickCount: 600,
})

const sourceNode = simulation.nodes[0]!
const contentHash = 'sha256-swarm-200mb'
const contentKey = 'content-swarm-1'

sourceNode.replicaStore.declareTotal(contentHash, TOTAL_PIECES)
for (let index = 0; index < TOTAL_PIECES; index++) {
  sourceNode.replicaStore.addPiece(contentHash, index)
}

simulation.publishAnnouncement({
  pubkey: sourceNode.id,
  qkey: contentKey,
  hash: contentHash,
  sizeBytes: TOTAL_PIECES * PIECE_SIZE,
  pieces: TOTAL_PIECES,
  pieceSize: PIECE_SIZE,
  ttl: 86400,
}, 0)

simulation.metrics.setInterestedNodes(
  contentKey,
  new Set(simulation.nodes.slice(1, 301).map((node) => node.id)),
)

let totalSourceBytes = 0
let totalReplicaBytes = 0

simulation.on('tick', (round: number) => {
  for (const node of simulation.nodes) {
    if (!node.online || node === sourceNode) {
      continue
    }
    if (node.replicaStore.isComplete(contentHash)) {
      continue
    }

    const providers: Array<{ nodeId: string; reputation: number; pieceRanges: [number, number][] }> = []
    const bestReplica = node.neighbourState.bestReplicaNeighbour(contentKey)
    if (bestReplica) {
      const bestNode = simulation.nodes.find((candidate) => candidate.id === bestReplica)
      if (bestNode?.replicaStore.heldPieces(contentHash).size) {
        providers.push({
          nodeId: bestReplica,
          reputation: node.reputationMap.get(bestReplica),
          pieceRanges: [[0, TOTAL_PIECES - 1]],
        })
      }
    }

    providers.push({
      nodeId: sourceNode.id,
      reputation: 0.5,
      pieceRanges: [[0, TOTAL_PIECES - 1]],
    })

    node.replicaStore.declareTotal(contentHash, TOTAL_PIECES)
    const tasks = selectPiecesToFetch(contentHash, TOTAL_PIECES, node.replicaStore, providers)
    const toFetch = tasks.slice(0, 4)
    for (const task of toFetch) {
      node.replicaStore.addPiece(contentHash, task.pieceIndex)
      const bytes = PIECE_SIZE
      if (task.provider === sourceNode.id) {
        totalSourceBytes += bytes
        simulation.metrics.recordSourceBytes(round, bytes)
      }
      simulation.metrics.recordContentBytes(round, bytes)
      node.metrics.piecesFetched += 1
    }
  }

  if (round % 100 === 0) {
    process.stdout.write(`  tick ${round}/600\r`)
  }
})

await simulation.run()
const report = simulation.report([contentKey])
printReport(report)

const completeNodes = simulation.nodes.filter((node) => node.replicaStore.isComplete(contentHash)).length
const totalBytes = totalSourceBytes
console.log(`\n  complete replicas: ${completeNodes}/${simulation.nodes.length}`)
console.log(`  source served: ${totalBytes > 0 ? 'tracked' : '0'} bytes`)
