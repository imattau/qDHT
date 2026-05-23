import { ReplicaStore } from './replica-store.js'

export interface PieceProvider {
  nodeId: string
  reputation: number
  pieceRanges: [number, number][]
}

export interface PieceFetchTask {
  pieceIndex: number
  provider: string
}

function providerCanServe(provider: PieceProvider, pieceIndex: number): boolean {
  return provider.pieceRanges.some(([start, end]) => pieceIndex >= start && pieceIndex <= end)
}

export function selectPiecesToFetch(
  hash: string,
  totalPieces: number,
  store: ReplicaStore,
  providers: PieceProvider[],
): PieceFetchTask[] {
  const missing: number[] = []
  for (let index = 0; index < totalPieces; index++) {
    if (!store.hasPiece(hash, index)) {
      missing.push(index)
    }
  }

  const providerByPiece = new Map<number, PieceProvider>()
  for (const index of missing) {
    const candidates = providers.filter((provider) => providerCanServe(provider, index))
    if (candidates.length > 0) {
      candidates.sort((left, right) => right.reputation - left.reputation)
      providerByPiece.set(index, candidates[0]!)
    }
  }

  return missing
    .filter((index) => providerByPiece.has(index))
    .sort((left, right) => {
      const leftProvider = providerByPiece.get(left)!
      const rightProvider = providerByPiece.get(right)!
      if (leftProvider.reputation !== rightProvider.reputation) {
        return rightProvider.reputation - leftProvider.reputation
      }
      return left - right
    })
    .map((index) => ({
      pieceIndex: index,
      provider: providerByPiece.get(index)!.nodeId,
    }))
}
