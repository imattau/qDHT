import EventEmitter from 'node:events'
import { GraphState } from '../../core/graph/graph-state.js'
import { type TopologyConfig } from '../../core/graph/topology.js'
import { buildAnnouncement, getTag, type QDHTAnnouncement } from '../../core/protocol/announcement.js'
import { MetricsCollector } from './metrics.js'
import { ChurnSchedule } from './churn.js'
import { buildReport, type SimReport } from './report.js'
import { SimNode } from '../node/sim-node.js'

export interface SimulationConfig {
  nodes: number
  topology: TopologyConfig
  gamma: number
  threshold: number
  tickCount: number
}

type InboxEnvelope = {
  from: string
  message: unknown
}

function isEnvelope(value: unknown): value is InboxEnvelope {
  return typeof value === 'object' && value !== null && 'from' in value && 'message' in value
}

function announcementKey(announcement: QDHTAnnouncement): string {
  const qkey = getTag(announcement, 'qkey') ?? ''
  const hash = getTag(announcement, 'hash') ?? ''
  return `${announcement.pubkey}|${qkey}|${hash}`
}

export class Simulation extends EventEmitter {
  readonly graph: GraphState
  readonly nodes: SimNode[]
  readonly metrics: MetricsCollector

  private churn = new ChurnSchedule()
  private round = 0
  private history = new Map<string, QDHTAnnouncement>()

  constructor(private config: SimulationConfig) {
    super()
    this.graph = new GraphState()
    config.topology.apply(this.graph)
    this.graph.recompute()

    this.nodes = Array.from({ length: config.nodes }, (_, index) => {
      const nodeId = this.graph.getNodeId(index) || `node-${index}`
      return new SimNode(nodeId, index, this.graph, config.threshold)
    })
    this.metrics = new MetricsCollector(config.nodes)

    for (const node of this.nodes) {
      node.setFetchHandler((noteId) => {
        this.forwardFetchedAnnouncement(node, noteId)
      })
    }
  }

  scheduleChurn(nodeId: string, offlineAt: number, onlineAt: number): void {
    this.churn.schedule(nodeId, { offlineAt, onlineAt })
  }

  publishAnnouncement(opts: Parameters<typeof buildAnnouncement>[0], atRound: number): string {
    const announcement = buildAnnouncement(opts)
    const key = announcementKey(announcement)
    this.history.set(key, announcement)
    const source = this.nodes.find((node) => node.id === opts.pubkey) ?? this.nodes[0]
    if (!source) {
      return key
    }

    source.inbox.enqueueFrom(source.id, announcement)
    this.metrics.recordAnnouncementSent(atRound)
    return key
  }

  async run(): Promise<void> {
    for (let round = 1; round <= this.config.tickCount; round++) {
      this.round = round
      this.metrics.startTick(round)

      for (const nodeId of this.churn.goingOffline(round)) {
        const node = this.nodes.find((candidate) => candidate.id === nodeId)
        if (node) {
          node.setOnline(false, round)
        }
      }

      for (const nodeId of this.churn.goingOnline(round)) {
        const node = this.nodes.find((candidate) => candidate.id === nodeId)
        if (node) {
          node.setOnline(true, round)
          this.triggerDeltaCatchup(node)
        }
      }

      for (const node of this.nodes) {
        if (!node.online) {
          continue
        }

        const messages = node.inbox.drain()
        for (const raw of messages) {
          const envelope = isEnvelope(raw) ? raw : { from: node.id, message: raw }
          const message = envelope.message
          if (this.processMessage(node, envelope.from, message, round)) {
            continue
          }
        }
        node.tick(round, this.config.gamma)
      }

      this.metrics.recordReplicaCount(round, this.countReplicaHolders())
      this.emit('tick', round, this.metrics.tickSnapshot(round))
      this.metrics.endTick(round)
      await Promise.resolve()
    }
  }

  report(keys: string[]): SimReport {
    return buildReport('qDHT', this.config.nodes, this.config.tickCount, this.metrics, keys)
  }

  private processMessage(node: SimNode, from: string, message: unknown, round: number): boolean {
    if (!message || typeof message !== 'object') {
      return false
    }

    const candidate = message as Record<string, unknown>
    if (candidate.kind !== 10800) {
      return false
    }

    const announcement = candidate as unknown as QDHTAnnouncement
    const qkey = getTag(announcement, 'qkey')
    if (!qkey) {
      return false
    }

    if (node.reputationMap.get(announcement.pubkey) < -0.5) {
      return true
    }

    node.receiveAnnouncement(announcement, from, round)
    this.metrics.recordDelivered(qkey, node.id)
    return true
  }

  private forwardFetchedAnnouncement(fromNode: SimNode, noteId: string): void {
    const announcement = fromNode.getAnnouncement(noteId)
    if (!announcement) {
      return
    }

    const qkey = getTag(announcement, 'qkey')
    const hash = getTag(announcement, 'hash')
    if (!qkey || !hash) {
      return
    }

    if (fromNode.reputationMap.get(announcement.pubkey) < -0.5) {
      return
    }

    const neighbours = this.graph.getNeighbors(fromNode.graphIndex)
    for (const neighbourIndex of neighbours) {
      const target = this.nodes[neighbourIndex]
      if (!target || !target.online || target.id === fromNode.id) {
        continue
      }

      target.inbox.enqueueFrom(fromNode.id, announcement)
      fromNode.metrics.announcementsSent += 1
      this.metrics.recordAnnouncementSent(this.round)
      fromNode.neighbourState.recordOutbound(qkey, hash, noteId, target.id, this.round, 1)
    }

    fromNode.removeAnnouncement(noteId)
  }

  private triggerDeltaCatchup(node: SimNode): void {
    if (node.offlineSince === null) {
      return
    }

    for (const announcement of this.history.values()) {
      node.inbox.enqueueFrom(announcement.pubkey, announcement)
    }
    node.offlineSince = null
  }

  private countReplicaHolders(): number {
    let count = 0
    for (const node of this.nodes) {
      if (node.replicaStore.allHashes().next().done === false) {
        count += 1
      }
    }
    return count
  }
}
