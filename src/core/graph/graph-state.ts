import { applyLaplacianSparse, buildLaplacian, type Complex, jacobiEigen } from './laplacian.js'

const EXACT_EIGEN_LIMIT = 128

export class GraphState {
  private nodeIds: string[] = []
  private idToIndex = new Map<string, number>()
  private neighbors = new Map<number, Set<number>>()
  private eigValues: number[] | null = null
  private eigVectors: number[][] | null = null

  setNodes(nodeIds: string[]): void {
    this.nodeIds = nodeIds.slice()
    this.idToIndex = new Map(nodeIds.map((id, index) => [id, index]))
    this.neighbors = new Map(nodeIds.map((_, index) => [index, new Set<number>()]))
    this.eigValues = null
    this.eigVectors = null
  }

  addNode(nodeId: string): number {
    const existing = this.idToIndex.get(nodeId)
    if (existing !== undefined) {
      return existing
    }

    const nextIndex = this.nodeIds.length
    this.nodeIds.push(nodeId)
    this.idToIndex.set(nodeId, nextIndex)
    this.neighbors.set(nextIndex, new Set<number>())
    this.eigValues = null
    this.eigVectors = null
    return nextIndex
  }

  setConnection(a: string, b: string, connected: boolean): void {
    const ai = this.idToIndex.get(a)
    const bi = this.idToIndex.get(b)
    if (ai === undefined || bi === undefined || ai === bi) {
      return
    }

    const aNeighbors = this.neighbors.get(ai)
    const bNeighbors = this.neighbors.get(bi)
    if (!aNeighbors || !bNeighbors) {
      return
    }

    if (connected) {
      aNeighbors.add(bi)
      bNeighbors.add(ai)
    } else {
      aNeighbors.delete(bi)
      bNeighbors.delete(ai)
    }
    this.eigValues = null
    this.eigVectors = null
  }

  recompute(): void {
    if (this.nodeIds.length === 0) {
      this.eigValues = null
      this.eigVectors = null
      return
    }

    if (this.nodeIds.length > EXACT_EIGEN_LIMIT) {
      this.eigValues = null
      this.eigVectors = null
      return
    }

    const laplacian = buildLaplacian(this.nodeIds.length, this.neighbors)
    const { values, vectors } = jacobiEigen(laplacian)
    this.eigValues = values
    this.eigVectors = vectors
  }

  amplitude(i: number, s: number, t: number): Complex {
    if (i < 0 || s < 0 || i >= this.nodeIds.length || s >= this.nodeIds.length) {
      return { real: 0, imag: 0 }
    }

    if (this.eigValues && this.eigVectors) {
      return this.amplitudeExact(i, s, t)
    }

    return this.amplitudeSparse(i, s, t)
  }

  getIndex(nodeId: string): number {
    return this.idToIndex.get(nodeId) ?? -1
  }

  getNodeId(index: number): string {
    return this.nodeIds[index] ?? ''
  }

  get size(): number {
    return this.nodeIds.length
  }

  getNeighbors(index: number): number[] {
    return [...(this.neighbors.get(index) ?? new Set<number>())]
  }

  private amplitudeExact(i: number, s: number, t: number): Complex {
    let real = 0
    let imag = 0

    for (let k = 0; k < this.eigValues!.length; k++) {
      const lambda = this.eigValues![k] ?? 0
      const phase = -lambda * t
      const cos = Math.cos(phase)
      const sin = Math.sin(phase)
      const vi = this.eigVectors![k]?.[i] ?? 0
      const vs = this.eigVectors![k]?.[s] ?? 0
      real += vi * cos * vs
      imag += vi * sin * vs
    }

    return { real, imag }
  }

  private amplitudeSparse(i: number, s: number, t: number): Complex {
    if (t === 0) {
      return i === s ? { real: 1, imag: 0 } : { real: 0, imag: 0 }
    }

    const maxTerms = 18
    let coeff: Complex = { real: 1, imag: 0 }
    let term: Complex[] = Array.from({ length: this.nodeIds.length }, (_, index) =>
      index === s ? { real: 1, imag: 0 } : { real: 0, imag: 0 },
    )
    const accum: Complex[] = Array.from({ length: this.nodeIds.length }, () => ({ real: 0, imag: 0 }))
    accum[s]!.real = 1

    for (let k = 1; k <= maxTerms; k++) {
      term = applyLaplacianSparse(term, this.neighbors)

      const nextCoeff: Complex = {
        real: (coeff.imag * t) / k,
        imag: (-coeff.real * t) / k,
      }
      coeff = nextCoeff

      let maxMagnitude = 0
      for (let idx = 0; idx < this.nodeIds.length; idx++) {
        const tr = term[idx]?.real ?? 0
        const ti = term[idx]?.imag ?? 0
        const magnitude = Math.hypot(tr, ti)
        if (magnitude > maxMagnitude) {
          maxMagnitude = magnitude
        }
        accum[idx]!.real += coeff.real * tr - coeff.imag * ti
        accum[idx]!.imag += coeff.real * ti + coeff.imag * tr
      }

      if (maxMagnitude * Math.hypot(coeff.real, coeff.imag) < 1e-10) {
        break
      }
    }

    return accum[i] ?? { real: 0, imag: 0 }
  }
}
