export class ReplicaStore {
  private pieces = new Map<string, Set<number>>()
  private totals = new Map<string, number>()

  declareTotal(hash: string, count: number): void {
    this.totals.set(hash, count)
    if (!this.pieces.has(hash)) {
      this.pieces.set(hash, new Set<number>())
    }
  }

  addPiece(hash: string, index: number): void {
    let set = this.pieces.get(hash)
    if (!set) {
      set = new Set<number>()
      this.pieces.set(hash, set)
    }
    set.add(index)
  }

  hasPiece(hash: string, index: number): boolean {
    return this.pieces.get(hash)?.has(index) ?? false
  }

  isComplete(hash: string): boolean {
    const total = this.totals.get(hash)
    if (total === undefined) {
      return false
    }
    return (this.pieces.get(hash)?.size ?? 0) >= total
  }

  heldPieces(hash: string): Set<number> {
    return this.pieces.get(hash) ?? new Set<number>()
  }

  allHashes(): IterableIterator<string> {
    return this.pieces.keys()
  }
}
