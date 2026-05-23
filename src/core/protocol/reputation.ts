export function reputationFactor(rep: number, gamma: number, t: number): number {
  if (rep >= 0) {
    return 1
  }
  return Math.exp(-2 * gamma * Math.abs(rep) * t)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export class ReputationMap {
  private scores = new Map<string, number>()

  get(nodeId: string): number {
    return this.scores.get(nodeId) ?? 0
  }

  set(nodeId: string, score: number): void {
    this.scores.set(nodeId, clamp(score, -1, 1))
  }

  adjust(nodeId: string, delta: number): void {
    this.set(nodeId, this.get(nodeId) + delta)
  }

  merge(nodeId: string, neighbourScore: number, weight: number): void {
    const local = this.get(nodeId)
    const w = Math.max(0, weight)
    this.set(nodeId, (local + neighbourScore * w) / (1 + w))
  }

  snapshot(): Map<string, number> {
    return new Map(this.scores)
  }
}
