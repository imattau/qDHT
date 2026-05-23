export interface TickSnapshot {
  round: number
  announcementBandwidth: number
  contentBandwidth: number
  sourceBandwidth: number
  replicaCount: number
}

export class MetricsCollector {
  private ticks = new Map<number, TickSnapshot>()
  private current: TickSnapshot | null = null
  private interested = new Map<string, Set<string>>()
  private delivered = new Map<string, Set<string>>()

  constructor(readonly nodeCount: number) {}

  startTick(round: number): void {
    this.current = {
      round,
      announcementBandwidth: 0,
      contentBandwidth: 0,
      sourceBandwidth: 0,
      replicaCount: 0,
    }
  }

  endTick(round: number): void {
    if (this.current) {
      this.ticks.set(round, this.current)
    }
    this.current = null
  }

  recordAnnouncementSent(_round: number): void {
    if (this.current) {
      this.current.announcementBandwidth += 1
    }
  }

  recordContentBytes(_round: number, bytes: number): void {
    if (this.current) {
      this.current.contentBandwidth += bytes
    }
  }

  recordSourceBytes(_round: number, bytes: number): void {
    if (this.current) {
      this.current.sourceBandwidth += bytes
    }
  }

  recordReplicaCount(_round: number, count: number): void {
    if (this.current) {
      this.current.replicaCount = count
    }
  }

  setInterestedNodes(key: string, nodes: Set<string>): void {
    this.interested.set(key, new Set(nodes))
  }

  recordDelivered(key: string, nodeId: string): void {
    let delivered = this.delivered.get(key)
    if (!delivered) {
      delivered = new Set<string>()
      this.delivered.set(key, delivered)
    }
    delivered.add(nodeId)
  }

  coverage(key: string): number {
    const interested = this.interested.get(key)
    if (!interested || interested.size === 0) {
      return 0
    }
    const delivered = this.delivered.get(key)
    if (!delivered) {
      return 0
    }

    let count = 0
    for (const nodeId of interested) {
      if (delivered.has(nodeId)) {
        count += 1
      }
    }
    return count / interested.size
  }

  tickSnapshot(round: number): TickSnapshot | undefined {
    return this.ticks.get(round)
  }

  allTicks(): TickSnapshot[] {
    return [...this.ticks.values()].sort((left, right) => left.round - right.round)
  }
}
