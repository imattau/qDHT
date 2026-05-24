export type Complex = {
  real: number
  imag: number
}

export function buildLaplacian(n: number, neighbors: Map<number, Set<number>>): number[][] {
  const matrix: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0))

  for (let i = 0; i < n; i++) {
    const nbrs = neighbors.get(i) ?? new Set<number>()
    matrix[i]![i] = nbrs.size
    for (const j of nbrs) {
      matrix[i]![j] = -1
    }
  }

  return matrix
}

export function jacobiEigen(a: number[][]): { values: number[]; vectors: number[][] } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Matrix, EigenvalueDecomposition } = require('ml-matrix') as typeof import('ml-matrix')
  const evd = new EigenvalueDecomposition(new Matrix(a))
  const rawValues = evd.realEigenvalues as number[]
  const rawVectors = evd.eigenvectorMatrix.to2DArray() as number[][]

  const order = rawValues
    .map((_, i) => i)
    .sort((left, right) => rawValues[left]! - rawValues[right]!)

  return {
    values: order.map((index) => rawValues[index]!),
    vectors: order.map((index) => rawVectors.map((row) => row[index] ?? 0)),
  }
}

export function applyLaplacianSparse(vec: Complex[], neighbors: Map<number, Set<number>>): Complex[] {
  const n = vec.length
  const out: Complex[] = Array.from({ length: n }, () => ({ real: 0, imag: 0 }))

  for (let i = 0; i < n; i++) {
    const nbrs = neighbors.get(i) ?? new Set<number>()
    let real = nbrs.size * (vec[i]?.real ?? 0)
    let imag = nbrs.size * (vec[i]?.imag ?? 0)

    for (const j of nbrs) {
      real -= vec[j]?.real ?? 0
      imag -= vec[j]?.imag ?? 0
    }

    out[i]!.real = real
    out[i]!.imag = imag
  }

  return out
}
