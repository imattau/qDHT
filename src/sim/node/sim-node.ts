import { GraphState } from '../../core/graph/graph-state.js'
import { type QDHTAnnouncement, getTag } from '../../core/protocol/announcement.js'
import { NeighbourStateMap } from '../../core/neighbour-state.js'
import { Propagator } from '../../core/propagation/propagator.js'
import { ReputationMap } from '../../core/protocol/reputation.js'
import { ReplicaStore } from '../../core/content/replica-store.js'
import { Inbox } from './inbox.js'

export interface NodeMetrics {
  announcementsSent: number
  announcementsReceived: number
  replicasSent: number
  replicasReceived: number
  piecesFetched: number
  bytesServed: number
}

function announcementKey(announcement: QDHTAnnouncement): string {
  const qkey = getTag(announcement, 'qkey') ?? ''
  const hash = getTag(announcement, 'hash') ?? ''
  return `${announcement.pubkey}|${qkey}|${hash}`
}

export class SimNode {
  readonly id: string
  readonly graphIndex: number
  online = true
  offlineSince: number | null = null

  readonly propagator: Propagator
  readonly neighbourState = new NeighbourStateMap()
  readonly replicaStore = new ReplicaStore()
  readonly reputationMap = new ReputationMap()
  readonly inbox = new Inbox()
  readonly metrics: NodeMetrics = {
    announcementsSent: 0,
    announcementsReceived: 0,
    replicasSent: 0,
    replicasReceived: 0,
    piecesFetched: 0,
    bytesServed: 0,
  }

  private announcements = new Map<string, QDHTAnnouncement>()

  constructor(
    id: string,
    graphIndex: number,
    graph: GraphState,
    threshold: number,
  ) {
    this.id = id
    this.graphIndex = graphIndex
    this.propagator = new Propagator(graph, graphIndex, threshold)
    this.propagator.setReputationLookup((pubkey) => this.reputationMap.get(pubkey))
  }

  setFetchHandler(handler: (id: string, sourceId: string) => void): void {
    this.propagator.setFetchHandler(handler)
  }

  setOnline(online: boolean, round: number): void {
    if (this.online === online) {
      return
    }

    if (!online) {
      this.offlineSince = round
    }

    this.online = online
    this.inbox.setOnline(online)
  }

  receiveAnnouncement(announcement: QDHTAnnouncement, fromNode: string, round: number): boolean {
    const qkey = getTag(announcement, 'qkey')
    const hash = getTag(announcement, 'hash')
    if (!qkey || !hash) {
      return false
    }

    const key = announcementKey(announcement)
    this.metrics.announcementsReceived += 1
    this.neighbourState.recordInbound(qkey, hash, key, fromNode, round)
    this.neighbourState.updateReplica(qkey, fromNode, true, [])
    this.announcements.set(key, announcement)
    this.propagator.addNote(key, fromNode, announcement.pubkey, round)
    return true
  }

  tick(round: number, gamma: number): void {
    this.propagator.tick(round, gamma)
  }

  getAnnouncement(key: string): QDHTAnnouncement | undefined {
    return this.announcements.get(key)
  }

  removeAnnouncement(key: string): void {
    this.announcements.delete(key)
  }
}
