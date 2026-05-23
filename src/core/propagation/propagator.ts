import { GraphState } from '../graph/graph-state.js'
import { reputationFactor } from '../protocol/reputation.js'

interface ActiveNote {
  id: string
  sourceId: string
  sourceIndex: number
  pubkey: string
  bornRound: number
}

export class Propagator {
  private notes: ActiveNote[] = []
  private positions = new Map<string, number>()
  private fetched = new Map<string, number>()
  private reputationLookup: ((pubkey: string) => number) | undefined
  private fetchHandler: ((id: string, sourceId: string) => void) | undefined

  maxActive = 10_000
  maxAgeRounds = 600

  constructor(
    private graph: GraphState,
    private localIndex: number,
    private threshold: number,
    fetchHandler?: (id: string, sourceId: string) => void,
  ) {
    this.fetchHandler = fetchHandler
  }

  setReputationLookup(fn: (pubkey: string) => number): void {
    this.reputationLookup = fn
  }

  setFetchHandler(fn: (id: string, sourceId: string) => void): void {
    this.fetchHandler = fn
  }

  addNote(id: string, sourceId: string, pubkey: string, bornRound: number): void {
    if (this.fetched.has(id)) {
      return
    }

    const existing = this.positions.get(id)
    if (existing !== undefined) {
      this.notes[existing]!.sourceId = sourceId
      this.notes[existing]!.sourceIndex = this.graph.getIndex(sourceId)
      return
    }

    const note: ActiveNote = {
      id,
      sourceId,
      sourceIndex: this.graph.getIndex(sourceId),
      pubkey,
      bornRound,
    }
    this.positions.set(id, this.notes.length)
    this.notes.push(note)

    if (this.notes.length > this.maxActive) {
      this.removeAt(0)
    }
  }

  tick(round: number, gamma: number): void {
    this.pruneExpired(round)
    const probabilityCache = new Map<string, number>()

    let index = 0
    while (index < this.notes.length) {
      const note = this.notes[index]!
      const sourceIndex = note.sourceIndex >= 0 ? note.sourceIndex : this.localIndex
      const cacheKey = `${note.id}:${sourceIndex}:${note.bornRound}`
      let probability = probabilityCache.get(cacheKey)

      if (probability === undefined) {
        const age = Math.max(0, round - note.bornRound)
        const amplitude = this.graph.amplitude(this.localIndex, sourceIndex, age)
        probability = amplitude.real * amplitude.real + amplitude.imag * amplitude.imag
        probability *= reputationFactor(this.reputationLookup?.(note.pubkey) ?? 0, gamma, age)
        if (age > 0) {
          const exploration = 0.02 * (1 - Math.exp(-age / 25))
          if (!Number.isFinite(probability) || probability < exploration) {
            probability = exploration
          }
        }
        probabilityCache.set(cacheKey, probability)
      }

      if (probability > this.threshold) {
        const noteId = note.id
        const sourceId = note.sourceId
        this.removeAt(index)
        this.fetched.set(noteId, round)
        this.fetchHandler?.(noteId, sourceId)
        continue
      }

      index += 1
    }
  }

  activeCount(): number {
    return this.notes.length
  }

  hasNote(id: string): boolean {
    return this.positions.has(id)
  }

  private pruneExpired(round: number): void {
    if (this.maxAgeRounds <= 0) {
      return
    }

    let index = 0
    while (index < this.notes.length) {
      if (round - this.notes[index]!.bornRound > this.maxAgeRounds) {
        this.removeAt(index)
      } else {
        index += 1
      }
    }
  }

  private removeAt(index: number): void {
    const last = this.notes.length - 1
    if (index < 0 || index > last) {
      return
    }

    const noteId = this.notes[index]!.id
    this.positions.delete(noteId)

    if (index !== last) {
      const moved = this.notes[last]!
      this.notes[index] = moved
      this.positions.set(moved.id, index)
    }

    this.notes.length = last
  }
}
