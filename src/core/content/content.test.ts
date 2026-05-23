import { describe, expect, it } from 'vitest'
import { ReplicaStore } from './replica-store.js'
import { selectPiecesToFetch } from './piece-fetcher.js'

describe('ReplicaStore', () => {
  it('tracks piece availability', () => {
    const store = new ReplicaStore()
    store.addPiece('hash1', 0)
    store.addPiece('hash1', 2)
    expect(store.hasPiece('hash1', 0)).toBe(true)
    expect(store.hasPiece('hash1', 1)).toBe(false)
    expect(store.hasPiece('hash1', 2)).toBe(true)
  })

  it('reports complete when all pieces present', () => {
    const store = new ReplicaStore()
    store.declareTotal('hash1', 3)
    store.addPiece('hash1', 0)
    store.addPiece('hash1', 1)
    store.addPiece('hash1', 2)
    expect(store.isComplete('hash1')).toBe(true)
  })

  it('reports incomplete when pieces missing', () => {
    const store = new ReplicaStore()
    store.declareTotal('hash1', 3)
    store.addPiece('hash1', 0)
    expect(store.isComplete('hash1')).toBe(false)
  })
})

describe('selectPiecesToFetch', () => {
  it('selects missing pieces from providers', () => {
    const store = new ReplicaStore()
    store.declareTotal('h1', 4)
    store.addPiece('h1', 0)

    const providers = [
      { nodeId: 'n1', reputation: 0.5, pieceRanges: [[0, 3]] as [number, number][] },
    ]
    const selected = selectPiecesToFetch('h1', 4, store, providers)
    expect(selected.map((task) => task.pieceIndex)).toEqual([1, 2, 3])
    expect(selected.every((task) => task.provider === 'n1')).toBe(true)
  })

  it('prefers higher reputation providers', () => {
    const store = new ReplicaStore()
    store.declareTotal('h1', 2)

    const providers = [
      { nodeId: 'low', reputation: 0.1, pieceRanges: [[0, 1]] as [number, number][] },
      { nodeId: 'high', reputation: 0.9, pieceRanges: [[0, 1]] as [number, number][] },
    ]
    const selected = selectPiecesToFetch('h1', 2, store, providers)
    expect(selected[0]!.provider).toBe('high')
  })
})
