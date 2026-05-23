import { describe, expect, it } from 'vitest'
import { Topology } from '../../core/graph/topology.js'
import { GraphState } from '../../core/graph/graph-state.js'
import { buildAnnouncement, getTag, type QDHTAnnouncement } from '../../core/protocol/announcement.js'
import { ChurnSchedule } from './churn.js'
import { MetricsCollector } from './metrics.js'
import { buildReport, type SimReport } from './report.js'
import { Simulation } from './simulation.js'

type NodeId = bigint

const NODE_COUNT = 500
const TICKS = 500
const CONTENT_KEY = 'comparison-content-1'
const CONTENT_HASH = 'sha256-comparison-1'
const CONTENT_NAME = 'comparison.bin'
const CONTENT_SIZE = 10 * 1024 * 1024
const PIECES = 40
const PIECE_SIZE = 256 * 1024
const INTERESTED_COUNT = 200
const K = 20
const ALPHA = 3
const REPUBLISH_INTERVAL = 60
const BUCKET_REFRESH = 30

interface ComparisonScenario {
  key: string
  hash: string
  name: string
  churnSeed: number
  churnRate: number
  churnWindowStart: number
  churnWindowSpan: number
  churnRecoveryDelay: number
  qdhtThreshold: number
}

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

function closestNodes<T extends { nodeId: NodeId; online: boolean }>(target: NodeId, allNodes: T[], k: number): T[] {
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

interface KadNode {
  id: string
  nodeId: NodeId
  online: boolean
  buckets: Map<number, string[]>
  store: Map<string, string>
  inbox: unknown[]
  metrics: { sends: number; receives: number; stores: number }
}

interface SpamNode {
  id: string
  nodeId: NodeId
  online: boolean
  inbox: Array<{ from: string; message: QDHTAnnouncement }>
  seen: Set<string>
}

function announcementKey(announcement: QDHTAnnouncement): string {
  const qkey = getTag(announcement, 'qkey') ?? ''
  const hash = getTag(announcement, 'hash') ?? ''
  return `${announcement.pubkey}|${qkey}|${hash}`
}

function makeChurnEvents(nodes: Array<{ id: string }>, seed: number, churnRate: number, windowStart: number, windowSpan: number, recoveryDelay: number): Array<{ id: string; offlineAt: number; onlineAt: number }> {
  const prng = makePrng(seed)
  const churned = nodes.filter(() => prng() < churnRate)
  return churned.map((node) => {
    const offlineAt = Math.floor(prng() * windowSpan) + windowStart
    return {
      id: node.id,
      offlineAt,
      onlineAt: offlineAt + recoveryDelay,
    }
  })
}

async function runQDHTComparison(scenario: ComparisonScenario): Promise<SimReport> {
  const simulation = new Simulation({
    nodes: NODE_COUNT,
    topology: Topology.barabasiAlbert({ n: NODE_COUNT, m: 3, seed: 42 }),
    gamma: 0.5,
    threshold: scenario.qdhtThreshold,
    tickCount: TICKS,
  })

  simulation.publishAnnouncement({
    pubkey: simulation.nodes[0]!.id,
    qkey: scenario.key,
    hash: scenario.hash,
    sizeBytes: CONTENT_SIZE,
    pieces: PIECES,
    pieceSize: PIECE_SIZE,
    ttl: 86400,
    name: scenario.name,
  }, 0)

  const interested = new Set(simulation.nodes.slice(1, INTERESTED_COUNT + 1).map((node) => node.id))
  simulation.metrics.setInterestedNodes(scenario.key, interested)

  const churnEvents = makeChurnEvents(simulation.nodes, scenario.churnSeed, scenario.churnRate, scenario.churnWindowStart, scenario.churnWindowSpan, scenario.churnRecoveryDelay)
  for (const event of churnEvents) {
    simulation.scheduleChurn(event.id, event.offlineAt, event.onlineAt)
  }
  await simulation.run()
  return simulation.report([scenario.key])
}

async function runKademliaComparison(scenario: ComparisonScenario): Promise<SimReport> {
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
  for (const event of makeChurnEvents(nodes, scenario.churnSeed, scenario.churnRate, scenario.churnWindowStart, scenario.churnWindowSpan, scenario.churnRecoveryDelay)) {
    churn.schedule(event.id, { offlineAt: event.offlineAt, onlineAt: event.onlineAt })
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

  const contentKeyId = randomId(12345)
  const targets = closestNodes(contentKeyId, nodes, K)
  for (const target of targets) {
    target.store.set(scenario.key, 'data')
    target.metrics.stores += 1
  }

  metrics.setInterestedNodes(scenario.key, new Set(nodes.slice(1, INTERESTED_COUNT + 1).map((node) => node.id)))

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
        if (payload.type === 'FIND_VALUE' && node.store.has(scenario.key)) {
          metrics.recordDelivered(scenario.key, String(payload.from))
        }
      }
    }

    if (tick % REPUBLISH_INTERVAL === 0) {
      for (const target of closestNodes(contentKeyId, nodes, K)) {
        target.store.set(scenario.key, 'data')
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
      if (!node.online || !node.store.has(scenario.key)) {
        continue
      }
      metrics.recordDelivered(scenario.key, node.id)
    }

    metrics.endTick(tick)
  }

  return buildReport('Kademlia', NODE_COUNT, TICKS, metrics, [scenario.key])
}

async function runSpamComparison(): Promise<[SimReport, SimReport]> {
  const nodes = 300
  const ticks = 300
  const spamNodes = 30
  const spamAnnouncementsPerNode = 10
  const spamKey = 'comparison-spam-content-1'
  const spamHash = 'sha256-comparison-spam-1'
  const spamName = 'spam-comparison.bin'

  const simulation = new Simulation({
    nodes,
    topology: Topology.barabasiAlbert({ n: nodes, m: 3, seed: 42 }),
    gamma: 0.5,
    threshold: 0.25,
    tickCount: ticks,
  })

  for (const spammer of simulation.nodes.slice(0, spamNodes)) {
    for (const node of simulation.nodes) {
      node.reputationMap.set(spammer.id, -0.9)
    }

    for (let index = 0; index < spamAnnouncementsPerNode; index++) {
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
    qkey: spamKey,
    hash: spamHash,
    sizeBytes: CONTENT_SIZE,
    pieces: PIECES,
    pieceSize: PIECE_SIZE,
    ttl: 86400,
    name: spamName,
  }, 0)
  simulation.metrics.setInterestedNodes(
    spamKey,
    new Set(simulation.nodes.slice(1, 101).map((node) => node.id)),
  )

  await simulation.run()
  const qdht = simulation.report([spamKey])

  const graph = new GraphState()
  Topology.barabasiAlbert({ n: nodes, m: 3, seed: 42 }).apply(graph)

  const baselineNodes: SpamNode[] = Array.from({ length: nodes }, (_, index) => ({
    id: `spam-kad-${index}`,
    nodeId: randomId(index + 10_000),
    online: true,
    inbox: [],
    seen: new Set<string>(),
  }))

  const baselineMetrics = new MetricsCollector(nodes)
  const sourceNode = baselineNodes[100]
  if (!sourceNode) {
    throw new Error('missing spam comparison source node')
  }

  const legitAnnouncement = buildAnnouncement({
    pubkey: sourceNode.id,
    qkey: spamKey,
    hash: spamHash,
    sizeBytes: CONTENT_SIZE,
    pieces: PIECES,
    pieceSize: PIECE_SIZE,
    ttl: 86400,
    name: spamName,
  })
  sourceNode.inbox.push({ from: sourceNode.id, message: legitAnnouncement })

  for (let spammerIndex = 0; spammerIndex < spamNodes; spammerIndex++) {
    const spammer = baselineNodes[spammerIndex]
    if (!spammer) {
      continue
    }

    for (let index = 0; index < spamAnnouncementsPerNode; index++) {
      const announcement = buildAnnouncement({
        pubkey: spammer.id,
        qkey: `spam-key-${index}`,
        hash: `bad-hash-${index}`,
        sizeBytes: 0,
        pieces: 1,
        pieceSize: 1,
        ttl: 3600,
      })
      for (const node of baselineNodes) {
        if (node !== spammer) {
          node.inbox.push({ from: spammer.id, message: announcement })
        }
      }
    }
  }

  baselineMetrics.setInterestedNodes(spamKey, new Set(baselineNodes.slice(1, 101).map((node) => node.id)))

  for (let tick = 1; tick <= ticks; tick++) {
    baselineMetrics.startTick(tick)

    for (const node of baselineNodes) {
      if (!node.online) {
        continue
      }

      const messages = node.inbox.splice(0)
      for (const envelope of messages) {
        const parsed = envelope.message
        if (!parsed || typeof parsed !== 'object') {
          continue
        }

        const announcement = parsed as QDHTAnnouncement
        const key = announcementKey(announcement)
        if (node.seen.has(key)) {
          continue
        }
        node.seen.add(key)

        const qkey = getTag(announcement, 'qkey')
        if (qkey === spamKey) {
          baselineMetrics.recordDelivered(spamKey, node.id)
        }

        const targets = closestNodes(node.nodeId, baselineNodes, K)
        for (const target of targets) {
          if (target.id === node.id || !target.online) {
            continue
          }
          target.inbox.push({ from: node.id, message: announcement })
          baselineMetrics.recordAnnouncementSent(tick)
        }
      }
    }

    baselineMetrics.endTick(tick)
  }

  const baseline = buildReport('NoFilter', nodes, ticks, baselineMetrics, [spamKey])
  return [qdht, baseline]
}

describe('qDHT vs production DHT baseline', () => {
  const scenarios: ComparisonScenario[] = [
    {
      key: CONTENT_KEY,
      hash: CONTENT_HASH,
      name: CONTENT_NAME,
      churnSeed: 7,
      churnRate: 0.2,
      churnWindowStart: 50,
      churnWindowSpan: 200,
      churnRecoveryDelay: 50,
      qdhtThreshold: 0.25,
    },
    {
      key: 'comparison-content-2',
      hash: 'sha256-comparison-2',
      name: 'comparison-churn.bin',
      churnSeed: 17,
      churnRate: 0.35,
      churnWindowStart: 50,
      churnWindowSpan: 250,
      churnRecoveryDelay: 75,
      qdhtThreshold: 0.25,
    },
  ]

  for (const scenario of scenarios) {
    it(`delivers broader coverage with less announcement traffic under ${scenario.key}`, async () => {
      const [qdht, kademlia] = await Promise.all([runQDHTComparison(scenario), runKademliaComparison(scenario)])

      const qdhtCoverage = qdht.coverage[scenario.key] ?? 0
      const kademliaCoverage = kademlia.coverage[scenario.key] ?? 0

      expect(qdhtCoverage).toBeGreaterThan(kademliaCoverage)
      expect(qdhtCoverage).toBeGreaterThanOrEqual(0.99)
      expect(kademliaCoverage).toBeLessThan(0.2)
      expect(qdht.totalAnnouncementBandwidth).toBeLessThan(kademlia.totalAnnouncementBandwidth)
    })
  }

  it('suppresses spam with less traffic than a no-filter baseline', async () => {
    const [qdht, baseline] = await runSpamComparison()
    const qdhtCoverage = qdht.coverage['comparison-spam-content-1'] ?? 0
    const baselineCoverage = baseline.coverage['comparison-spam-content-1'] ?? 0

    expect(qdhtCoverage).toBeGreaterThanOrEqual(baselineCoverage)
    expect(qdhtCoverage).toBeGreaterThanOrEqual(0.1)
    expect(qdht.totalAnnouncementBandwidth).toBeLessThan(baseline.totalAnnouncementBandwidth)
  })
})
