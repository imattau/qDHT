export interface InboundNeighbour {
  firstSeen: number
  lastSeen: number
  probability: number
  reputation: number
  hasReplica: boolean
  pieceRanges: [number, number][]
  latency: number
}

export interface OutboundNeighbour {
  sentAt: number
  probability: number
}

export interface AnnouncementNeighbourState {
  key: string
  hash: string
  announcementId: string
  firstSeen: number
  lastSeen: number
  inbound: Map<string, InboundNeighbour>
  outbound: Map<string, OutboundNeighbour>
}

export class NeighbourStateMap {
  private states = new Map<string, AnnouncementNeighbourState>()

  get(key: string): AnnouncementNeighbourState | undefined {
    return this.states.get(key)
  }

  recordInbound(key: string, hash: string, announcementId: string, fromNode: string, round: number): void {
    const state = this.getOrCreate(key, hash, announcementId, round)
    const existing = state.inbound.get(fromNode)
    if (existing) {
      existing.lastSeen = round
      existing.probability = Math.min(1, existing.probability + 0.05)
      return
    }

    state.inbound.set(fromNode, {
      firstSeen: round,
      lastSeen: round,
      probability: 1,
      reputation: 0,
      hasReplica: false,
      pieceRanges: [],
      latency: 0,
    })
  }

  recordOutbound(
    key: string,
    hash: string,
    announcementId: string,
    toNode: string,
    round: number,
    probability = 1,
  ): void {
    const state = this.getOrCreate(key, hash, announcementId, round)
    state.outbound.set(toNode, {
      sentAt: round,
      probability,
    })
  }

  updateReplica(key: string, nodeId: string, hasReplica: boolean, pieceRanges: [number, number][]): void {
    const state = this.states.get(key)
    if (!state) {
      return
    }
    const neighbour = state.inbound.get(nodeId)
    if (!neighbour) {
      return
    }
    neighbour.hasReplica = hasReplica
    neighbour.pieceRanges = pieceRanges
  }

  bestReplicaNeighbour(key: string): string | null {
    const state = this.states.get(key)
    if (!state) {
      return null
    }

    let bestId: string | null = null
    let bestScore = Number.NEGATIVE_INFINITY
    for (const [nodeId, neighbour] of state.inbound) {
      if (!neighbour.hasReplica) {
        continue
      }
      const score = neighbour.probability + neighbour.reputation - neighbour.latency / 1000
      if (score > bestScore) {
        bestScore = score
        bestId = nodeId
      }
    }
    return bestId
  }

  keys(): IterableIterator<string> {
    return this.states.keys()
  }

  private getOrCreate(key: string, hash: string, announcementId: string, round: number): AnnouncementNeighbourState {
    let state = this.states.get(key)
    if (!state) {
      state = {
        key,
        hash,
        announcementId,
        firstSeen: round,
        lastSeen: round,
        inbound: new Map(),
        outbound: new Map(),
      }
      this.states.set(key, state)
    }
    state.lastSeen = round
    return state
  }
}
