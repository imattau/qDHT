import { describe, expect, it } from 'vitest'
import { applyLaplacianSparse, buildLaplacian, jacobiEigen } from './laplacian.js'

describe('buildLaplacian', () => {
  it('builds the Laplacian for a triangle graph', () => {
    const neighbors = new Map<number, Set<number>>([
      [0, new Set([1, 2])],
      [1, new Set([0, 2])],
      [2, new Set([0, 1])],
    ])

    const laplacian = buildLaplacian(3, neighbors)
    expect(laplacian[0]).toEqual([2, -1, -1])
    expect(laplacian[1]).toEqual([-1, 2, -1])
    expect(laplacian[2]).toEqual([-1, -1, 2])
  })
})

describe('jacobiEigen', () => {
  it('returns eigenvalues 0, 3, 3 for a triangle graph', () => {
    const neighbors = new Map<number, Set<number>>([
      [0, new Set([1, 2])],
      [1, new Set([0, 2])],
      [2, new Set([0, 1])],
    ])
    const laplacian = buildLaplacian(3, neighbors)
    const { values } = jacobiEigen(laplacian)

    expect(values[0]).toBeCloseTo(0, 8)
    expect(values[1]).toBeCloseTo(3, 4)
    expect(values[2]).toBeCloseTo(3, 4)
  })
})

describe('applyLaplacianSparse', () => {
  it('applies L to a vector correctly', () => {
    const neighbors = new Map<number, Set<number>>([
      [0, new Set([1])],
      [1, new Set([0])],
    ])

    const result = applyLaplacianSparse(
      [
        { real: 1, imag: 0 },
        { real: 0, imag: 0 },
      ],
      neighbors,
    )

    expect(result[0]!.real).toBeCloseTo(1)
    expect(result[1]!.real).toBeCloseTo(-1)
  })
})
