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
  const n = a.length
  const mat = a.map((row) => row.slice())
  const vectors: number[][] = Array.from({ length: n }, (_, row) =>
    Array.from({ length: n }, (_, col) => (row === col ? 1 : 0)),
  )
  const epsilon = 1e-12
  const maxIter = Math.max(1, 64 * n * n)

  for (let iter = 0; iter < maxIter; iter++) {
    let p = 0
    let q = 0
    let maxVal = 0

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const value = Math.abs(mat[i]![j] ?? 0)
        if (value > maxVal) {
          maxVal = value
          p = i
          q = j
        }
      }
    }

    if (maxVal < epsilon) {
      break
    }

    const app = mat[p]![p] ?? 0
    const aqq = mat[q]![q] ?? 0
    const apq = mat[p]![q] ?? 0

    if (apq === 0) {
      continue
    }

    const tau = (aqq - app) / (2 * apq)
    const sign = tau >= 0 ? 1 : -1
    const t = sign / (Math.abs(tau) + Math.sqrt(1 + tau * tau))
    const c = 1 / Math.sqrt(1 + t * t)
    const s = t * c

    for (let k = 0; k < n; k++) {
      if (k === p || k === q) {
        continue
      }
      const akp = mat[k]![p] ?? 0
      const akq = mat[k]![q] ?? 0
      const newKp = c * akp - s * akq
      const newKq = c * akq + s * akp
      mat[k]![p] = newKp
      mat[p]![k] = newKp
      mat[k]![q] = newKq
      mat[q]![k] = newKq
    }

    mat[p]![p] = c * c * app - 2 * s * c * apq + s * s * aqq
    mat[q]![q] = s * s * app + 2 * s * c * apq + c * c * aqq
    mat[p]![q] = 0
    mat[q]![p] = 0

    for (let k = 0; k < n; k++) {
      const vkp = vectors[k]![p] ?? 0
      const vkq = vectors[k]![q] ?? 0
      vectors[k]![p] = c * vkp - s * vkq
      vectors[k]![q] = s * vkp + c * vkq
    }
  }

  const values = mat.map((row, i) => row[i] ?? 0)
  const order = values
    .map((_, i) => i)
    .sort((left, right) => values[left]! - values[right]!)

  return {
    values: order.map((index) => values[index] ?? 0),
    vectors: order.map((index) => vectors.map((row) => row[index] ?? 0)),
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
