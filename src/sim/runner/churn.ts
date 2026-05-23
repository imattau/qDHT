interface ChurnEvent {
  offlineAt: number
  onlineAt: number
}

export class ChurnSchedule {
  private offlineIndex = new Map<number, string[]>()
  private onlineIndex = new Map<number, string[]>()

  schedule(nodeId: string, event: ChurnEvent): void {
    const offline = this.offlineIndex.get(event.offlineAt) ?? []
    offline.push(nodeId)
    this.offlineIndex.set(event.offlineAt, offline)

    const online = this.onlineIndex.get(event.onlineAt) ?? []
    online.push(nodeId)
    this.onlineIndex.set(event.onlineAt, online)
  }

  goingOffline(round: number): string[] {
    return this.offlineIndex.get(round) ?? []
  }

  goingOnline(round: number): string[] {
    return this.onlineIndex.get(round) ?? []
  }
}
