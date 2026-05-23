import { Topology } from '../../core/graph/topology.js'
import { GraphState } from '../../core/graph/graph-state.js'
import { ChurnSchedule } from '../runner/churn.js'
import { MetricsCollector } from '../runner/metrics.js'
import { buildReport, printReport } from '../runner/report.js'

type NodeId = bigint

function xorDist(a: NodeId, b: NodeId): NodeId {
  return a ^ b
}

function randomId(seed: number): NodeId {
  let state = BigInt(seed)
  let id = 0n
  for (let index = 0; index < 5; index++) {
    state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn
    id = (id << 32n) | (state & 0xffffffffn)
  }
  return id & ((1n << 160n) - 1n)
}

interface KadNode {
  id: string
  nodeId: NodeId
  online: boolean
  buckets: Map<number, string[]>
  store: Map<string, string>
  inbox: unknown[]
  metrics: { sends: number; receives: number; stores: number }
}

const K = 20
const ALPHA = 3
const REPUBLISH_INTERVAL = 60
const BUCKET_REFRESH = 30
const NODE_COUNT = 500
const TICKS = 600

function bucketIndex(a: NodeId, b: NodeId): number {
  const dist = xorDist(a, b)
  if (dist === 0n) {
    return 0
  }
  let bit = 159
  while (bit > 0 && ((dist >> BigInt(bit)) & 1n) === 0n) {
    bit -= 1
  }
  return bit
}

function makePrng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function closestNodes(target: NodeId, allNodes: KadNode[], k: number): KadNode[] {
  return [...allNodes]
    .filter((node) => node.online)
    .sort((left, right) => {
      const leftDistance = xorDist(left.nodeId, target)
      const rightDistance = xorDist(right.nodeId, target)
      if (leftDistance === rightDistance) {
        return 0
      }
      return leftDistance < rightDistance ? -1 : 1
    })
    .slice(0, k)
}

const graph = new GraphState()
Topology.barabasiAlbert({ n: NODE_COUNT, m: 3, seed: 42 }).apply(graph)

const nodes: KadNode[] = Array.from({ length: NODE_COUNT }, (_, index) => ({
  id: `kad-${index}`,
  nodeId: randomId(index),
  online: true,
  buckets: new Map<number, string[]>(),
  store: new Map<string, string>(),
  inbox: [],
  metrics: { sends: 0, receives: 0, stores: 0 },
}))

const metrics = new MetricsCollector(NODE_COUNT)
const churn = new ChurnSchedule()

const churnRandom = makePrng(7)
const churnSet = nodes.filter(() => churnRandom() < 0.2)
for (const node of churnSet) {
  const offlineAt = Math.floor(churnRandom() * 200) + 50
  churn.schedule(node.id, { offlineAt, onlineAt: offlineAt + 50 })
}

const bootstrapRandom = makePrng(99)
for (const node of nodes) {
  const peers = [...nodes].sort(() => bootstrapRandom() - 0.5).slice(0, K).filter((peer) => peer !== node)
  for (const peer of peers) {
    const index = bucketIndex(node.nodeId, peer.nodeId)
    const bucket = node.buckets.get(index) ?? []
    if (!bucket.includes(peer.id)) {
      bucket.push(peer.id)
    }
    node.buckets.set(index, bucket.slice(-K))
  }
}

const contentKey = 'content-kad-1'
const contentKeyId = randomId(12345)
const targets = closestNodes(contentKeyId, nodes, K)
for (const target of targets) {
  target.store.set(contentKey, 'data')
  target.metrics.stores += 1
}

metrics.setInterestedNodes(contentKey, new Set(nodes.slice(1, 201).map((node) => node.id)))

for (let tick = 1; tick <= TICKS; tick++) {
  metrics.startTick(tick)

  for (const nodeId of churn.goingOffline(tick)) {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (node) {
      node.online = false
    }
  }

  for (const nodeId of churn.goingOnline(tick)) {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (node) {
      node.online = true
      const closest = closestNodes(node.nodeId, nodes, K)
      for (const peer of closest) {
        peer.inbox.push({ type: 'FIND_NODE', from: node.id, target: node.nodeId.toString() })
        metrics.recordAnnouncementSent(tick)
        node.metrics.sends += 1
      }
    }
  }

  for (const node of nodes) {
    if (!node.online) {
      continue
    }
    const messages = node.inbox.splice(0)
    for (const message of messages) {
      node.metrics.receives += 1
      const payload = message as Record<string, unknown>
      if (payload.type === 'FIND_VALUE' && node.store.has(contentKey)) {
        metrics.recordDelivered(contentKey, String(payload.from))
      }
    }
  }

  if (tick % REPUBLISH_INTERVAL === 0) {
    for (const target of closestNodes(contentKeyId, nodes, K)) {
      target.store.set(contentKey, 'data')
      metrics.recordAnnouncementSent(tick)
    }
  }

  if (tick % BUCKET_REFRESH === 0) {
    for (const node of nodes) {
      if (!node.online) {
        continue
      }
      for (const peer of closestNodes(node.nodeId, nodes, ALPHA)) {
        peer.inbox.push({ type: 'FIND_NODE', from: node.id, target: node.nodeId.toString() })
        metrics.recordAnnouncementSent(tick)
        node.metrics.sends += 1
      }
    }
  }

  for (const node of nodes) {
    if (!node.online || !node.store.has(contentKey)) {
      continue
    }
    metrics.recordDelivered(contentKey, node.id)
  }

  metrics.endTick(tick)
  if (tick % 100 === 0) {
    process.stdout.write(`  tick ${tick}/${TICKS}\r`)
  }
}

const report = buildReport('Kademlia', NODE_COUNT, TICKS, metrics, [contentKey])
printReport(report)
console.log(`\n  churned nodes: ${churnSet.length}`)
