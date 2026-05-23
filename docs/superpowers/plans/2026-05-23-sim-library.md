# Simulation Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic 500-node TypeScript simulation proving the qDHT model before networking is added.

**Architecture:** A `src/core/` library (pure qDHT logic, no sim concerns) wrapped by `src/sim/` (SimNode, tick runner, metrics, scenarios). Quantum walk ported from `rely/internal/quantum/`. In-process JSON inbox transport. Five scenarios plus a Kademlia baseline.

**Tech Stack:** Node.js 20+, TypeScript 5, Vitest, `tsx` for running scenarios directly.

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/core/.gitkeep`, `src/sim/.gitkeep`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "qdht",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "sim:stable": "tsx src/sim/scenarios/stable.ts",
    "sim:churn": "tsx src/sim/scenarios/churn.ts",
    "sim:spam": "tsx src/sim/scenarios/spam.ts",
    "sim:swarm": "tsx src/sim/scenarios/swarming.ts",
    "sim:dht-baseline": "tsx src/sim/scenarios/dht-baseline.ts"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "tsx": "^4.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist",
    "rootDir": "src",
    "paths": {
      "@core/*": ["src/core/*"],
      "@sim/*": ["src/sim/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': new URL('./src/core', import.meta.url).pathname,
      '@sim': new URL('./src/sim', import.meta.url).pathname,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npm run build
```

Expected: exits 0 (no source files yet, that's fine).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts
git commit -m "chore: scaffold TypeScript project"
```

---

## Task 2: Laplacian Matrix Ops

**Files:**
- Create: `src/core/graph/laplacian.ts`
- Create: `src/core/graph/laplacian.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/core/graph/laplacian.test.ts
import { describe, it, expect } from 'vitest'
import { buildLaplacian, jacobiEigen, applyLaplacianSparse } from './laplacian.js'

describe('buildLaplacian', () => {
  it('builds correct Laplacian for a triangle graph', () => {
    // nodes 0-1-2-0
    const neighbors = new Map([
      [0, new Set([1, 2])],
      [1, new Set([0, 2])],
      [2, new Set([0, 1])],
    ])
    const L = buildLaplacian(3, neighbors)
    expect(L[0]).toEqual([2, -1, -1])
    expect(L[1]).toEqual([-1, 2, -1])
    expect(L[2]).toEqual([-1, -1, 2])
  })
})

describe('jacobiEigen', () => {
  it('returns eigenvalues 0, 3, 3 for triangle Laplacian', () => {
    const neighbors = new Map([
      [0, new Set([1, 2])],
      [1, new Set([0, 2])],
      [2, new Set([0, 1])],
    ])
    const L = buildLaplacian(3, neighbors)
    const { values } = jacobiEigen(L)
    expect(values[0]!).toBeCloseTo(0, 8)
    expect(values[1]!).toBeCloseTo(3, 4)
    expect(values[2]!).toBeCloseTo(3, 4)
  })
})

describe('applyLaplacianSparse', () => {
  it('applies L to a vector correctly', () => {
    const neighbors = new Map([
      [0, new Set([1])],
      [1, new Set([0])],
    ])
    // L = [[1,-1],[-1,1]], v = [1,0] => Lv = [1,-1]
    const result = applyLaplacianSparse([{ real: 1, imag: 0 }, { real: 0, imag: 0 }], neighbors)
    expect(result[0]!.real).toBeCloseTo(1)
    expect(result[1]!.real).toBeCloseTo(-1)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/core/graph/laplacian.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement laplacian.ts**

```ts
// src/core/graph/laplacian.ts

export type Complex = { real: number; imag: number }

export function buildLaplacian(n: number, neighbors: Map<number, Set<number>>): number[][] {
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0) as number[])
  for (let i = 0; i < n; i++) {
    const nbrs = neighbors.get(i) ?? new Set<number>()
    L[i]![i] = nbrs.size
    for (const j of nbrs) {
      L[i]![j] = -1
    }
  }
  return L
}

export function jacobiEigen(a: number[][]): { values: number[]; vectors: number[][] } {
  const n = a.length
  const mat = a.map(row => [...row])
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  )
  const eps = 1e-12
  const maxIter = 64 * n * n

  for (let iter = 0; iter < maxIter; iter++) {
    let p = 0, q = 1, maxVal = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const val = Math.abs(mat[i]![j]!)
        if (val > maxVal) { maxVal = val; p = i; q = j }
      }
    }
    if (maxVal < eps) break

    const app = mat[p]![p]!, aqq = mat[q]![q]!, apq = mat[p]![q]!
    if (apq === 0) continue
    const tau = (aqq - app) / (2 * apq)
    const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau))
    const c = 1 / Math.sqrt(1 + t * t)
    const s = t * c

    for (let k = 0; k < n; k++) {
      if (k === p || k === q) continue
      const akp = mat[k]![p]!, akq = mat[k]![q]!
      mat[k]![p] = c * akp - s * akq; mat[p]![k] = mat[k]![p]!
      mat[k]![q] = c * akq + s * akp; mat[q]![k] = mat[k]![q]!
    }
    mat[p]![p] = c*c*app - 2*s*c*apq + s*s*aqq
    mat[q]![q] = s*s*app + 2*s*c*apq + c*c*aqq
    mat[p]![q] = 0; mat[q]![p] = 0

    for (let k = 0; k < n; k++) {
      const vkp = v[k]![p]!, vkq = v[k]![q]!
      v[k]![p] = c * vkp - s * vkq
      v[k]![q] = s * vkp + c * vkq
    }
  }

  const values = mat.map((row, i) => row[i]!)
  // sort ascending by eigenvalue
  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!)
  return {
    values: order.map(i => values[i]!),
    vectors: order.map(i => v.map(row => row[i]!)),
  }
}

export function applyLaplacianSparse(vec: Complex[], neighbors: Map<number, Set<number>>): Complex[] {
  const n = vec.length
  const out: Complex[] = Array.from({ length: n }, () => ({ real: 0, imag: 0 }))
  for (let i = 0; i < n; i++) {
    const nbrs = neighbors.get(i) ?? new Set<number>()
    if (nbrs.size === 0) continue
    let sumReal = nbrs.size * vec[i]!.real
    let sumImag = nbrs.size * vec[i]!.imag
    for (const j of nbrs) {
      sumReal -= vec[j]!.real
      sumImag -= vec[j]!.imag
    }
    out[i]!.real = sumReal
    out[i]!.imag = sumImag
  }
  return out
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/core/graph/laplacian.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/graph/laplacian.ts src/core/graph/laplacian.test.ts
git commit -m "feat(core): Laplacian matrix ops and Jacobi eigendecomposition"
```

---

## Task 3: GraphState

**Files:**
- Create: `src/core/graph/graph-state.ts`
- Create: `src/core/graph/graph-state.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/core/graph/graph-state.test.ts
import { describe, it, expect } from 'vitest'
import { GraphState } from './graph-state.js'

describe('GraphState', () => {
  it('returns amplitude 1 at source when t=0', () => {
    const g = new GraphState()
    g.setNodes(['a', 'b', 'c'])
    g.setConnection('a', 'b', true)
    g.setConnection('b', 'c', true)
    g.recompute()
    const amp = g.amplitude(0, 0, 0)
    expect(amp.real).toBeCloseTo(1)
    expect(amp.imag).toBeCloseTo(0)
  })

  it('returns amplitude 0 between different nodes at t=0', () => {
    const g = new GraphState()
    g.setNodes(['a', 'b'])
    g.setConnection('a', 'b', true)
    g.recompute()
    const amp = g.amplitude(0, 1, 0)
    expect(amp.real).toBeCloseTo(0)
    expect(amp.imag).toBeCloseTo(0)
  })

  it('probability sums to ~1 across all nodes at any t', () => {
    const g = new GraphState()
    g.setNodes(['a', 'b', 'c', 'd'])
    g.setConnection('a', 'b', true)
    g.setConnection('b', 'c', true)
    g.setConnection('c', 'd', true)
    g.recompute()
    let total = 0
    for (let i = 0; i < 4; i++) {
      const amp = g.amplitude(i, 0, 5)
      total += amp.real * amp.real + amp.imag * amp.imag
    }
    expect(total).toBeCloseTo(1, 2)
  })

  it('uses sparse path for graphs larger than 128 nodes', () => {
    const g = new GraphState()
    const nodes = Array.from({ length: 130 }, (_, i) => `n${i}`)
    g.setNodes(nodes)
    for (let i = 0; i < 129; i++) g.setConnection(`n${i}`, `n${i+1}`, true)
    g.recompute()
    // Should not throw; sparse path used
    const amp = g.amplitude(0, 0, 1)
    expect(typeof amp.real).toBe('number')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/core/graph/graph-state.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement graph-state.ts**

```ts
// src/core/graph/graph-state.ts
import { type Complex, buildLaplacian, jacobiEigen, applyLaplacianSparse } from './laplacian.js'

const EXACT_EIGEN_LIMIT = 128

export class GraphState {
  private nodes: string[] = []
  private idx: Map<string, number> = new Map()
  private neighbors: Map<number, Set<number>> = new Map()
  private n = 0
  private eigvals: number[] | null = null
  private eigvecs: number[][] | null = null  // eigvecs[nodeIndex][eigenIndex]

  setNodes(urls: string[]): void {
    this.n = urls.length
    this.nodes = [...urls]
    this.idx = new Map(urls.map((u, i) => [u, i]))
    this.neighbors = new Map(urls.map((_, i) => [i, new Set<number>()]))
    this.eigvals = null
    this.eigvecs = null
  }

  setConnection(a: string, b: string, connected: boolean): void {
    const ai = this.idx.get(a), bi = this.idx.get(b)
    if (ai === undefined || bi === undefined || ai === bi) return
    if (connected) {
      this.neighbors.get(ai)!.add(bi)
      this.neighbors.get(bi)!.add(ai)
    } else {
      this.neighbors.get(ai)!.delete(bi)
      this.neighbors.get(bi)!.delete(ai)
    }
  }

  recompute(): void {
    if (this.n === 0) { this.eigvals = null; this.eigvecs = null; return }
    if (this.n > EXACT_EIGEN_LIMIT) { this.eigvals = null; this.eigvecs = null; return }

    const L = buildLaplacian(this.n, this.neighbors)
    const { values, vectors } = jacobiEigen(L)
    this.eigvals = values
    // vectors[eigenIndex][nodeIndex] -> transpose to eigvecs[nodeIndex][eigenIndex]
    this.eigvecs = Array.from({ length: this.n }, (_, i) =>
      vectors.map(col => col[i]!)
    )
  }

  amplitude(i: number, s: number, t: number): Complex {
    if (i < 0 || s < 0 || i >= this.n || s >= this.n) return { real: 0, imag: 0 }
    if (this.eigvecs && this.eigvals) return this.amplitudeExact(i, s, t)
    return this.amplitudeSparse(i, s, t)
  }

  private amplitudeExact(i: number, s: number, t: number): Complex {
    let real = 0, imag = 0
    for (let k = 0; k < this.n; k++) {
      const phase = -this.eigvals![k]! * t
      const cos = Math.cos(phase), sin = Math.sin(phase)
      const vik = this.eigvecs![i]![k]!
      const vsk = this.eigvecs![s]![k]!
      // amp += vik * exp(-i*lambda*t) * vsk  (real eigenvectors)
      real += vik * cos * vsk
      imag += vik * sin * vsk
    }
    return { real, imag }
  }

  private amplitudeSparse(i: number, s: number, t: number): Complex {
    if (t === 0) return i === s ? { real: 1, imag: 0 } : { real: 0, imag: 0 }
    const maxTerms = 16
    const accum: Complex[] = Array.from({ length: this.n }, () => ({ real: 0, imag: 0 }))
    let term: Complex[] = Array.from({ length: this.n }, (_, idx) =>
      idx === s ? { real: 1, imag: 0 } : { real: 0, imag: 0 }
    )
    accum[s]!.real = 1
    let coeffReal = 1, coeffImag = 0

    for (let k = 1; k <= maxTerms; k++) {
      term = applyLaplacianSparse(term, this.neighbors)
      // coeff *= (-i*t) / k
      const newReal = (coeffReal * 0 - coeffImag * (-t)) / k
      const newImag = (coeffReal * (-t) + coeffImag * 0) / k
      coeffReal = newReal; coeffImag = newImag

      let maxMag = 0
      for (let idx = 0; idx < this.n; idx++) {
        const tr = term[idx]!.real, ti = term[idx]!.imag
        const mag = Math.sqrt(tr*tr + ti*ti)
        if (mag > maxMag) maxMag = mag
        accum[idx]!.real += coeffReal * tr - coeffImag * ti
        accum[idx]!.imag += coeffReal * ti + coeffImag * tr
      }
      const coeffMag = Math.sqrt(coeffReal*coeffReal + coeffImag*coeffImag)
      if (maxMag * coeffMag < 1e-10) break
    }
    return accum[i]!
  }

  getIndex(url: string): number {
    return this.idx.get(url) ?? -1
  }

  get size(): number { return this.n }
  getNodeId(index: number): string { return this.nodes[index] ?? '' }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/core/graph/graph-state.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/graph/graph-state.ts src/core/graph/graph-state.test.ts
git commit -m "feat(core): GraphState with exact/sparse quantum amplitude"
```

---

## Task 4: Topology Factory

**Files:**
- Create: `src/core/graph/topology.ts`
- Create: `src/core/graph/topology.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/core/graph/topology.test.ts
import { describe, it, expect } from 'vitest'
import { Topology } from './topology.js'
import { GraphState } from './graph-state.js'

describe('Topology.erdosRenyi', () => {
  it('creates n nodes', () => {
    const g = new GraphState()
    Topology.erdosRenyi({ n: 10, p: 0.5, seed: 42 }).apply(g)
    expect(g.size).toBe(10)
  })

  it('is deterministic with same seed', () => {
    const g1 = new GraphState(), g2 = new GraphState()
    Topology.erdosRenyi({ n: 20, p: 0.3, seed: 99 }).apply(g1)
    Topology.erdosRenyi({ n: 20, p: 0.3, seed: 99 }).apply(g2)
    // Check same amplitude (proxy for same topology)
    g1.recompute(); g2.recompute()
    const a1 = g1.amplitude(0, 1, 1)
    const a2 = g2.amplitude(0, 1, 1)
    expect(a1.real).toBeCloseTo(a2.real, 10)
  })
})

describe('Topology.barabasiAlbert', () => {
  it('creates n nodes with m edges per new node', () => {
    const g = new GraphState()
    Topology.barabasiAlbert({ n: 50, m: 2, seed: 1 }).apply(g)
    expect(g.size).toBe(50)
  })
})

describe('Topology.fromAdjacency', () => {
  it('builds topology from explicit adjacency list', () => {
    const g = new GraphState()
    Topology.fromAdjacency(['a', 'b', 'c'], [[0,1],[1,2]]).apply(g)
    g.recompute()
    expect(g.size).toBe(3)
    const amp = g.amplitude(0, 0, 0)
    expect(amp.real).toBeCloseTo(1)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/core/graph/topology.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement topology.ts**

```ts
// src/core/graph/topology.ts
import { GraphState } from './graph-state.js'

// Minimal seeded LCG for deterministic topology generation
function makePrng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export interface TopologyConfig {
  apply(g: GraphState): void
}

export const Topology = {
  erdosRenyi({ n, p, seed = 0 }: { n: number; p: number; seed?: number }): TopologyConfig {
    return {
      apply(g: GraphState) {
        const ids = Array.from({ length: n }, (_, i) => `node-${i}`)
        g.setNodes(ids)
        const rand = makePrng(seed)
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            if (rand() < p) g.setConnection(ids[i]!, ids[j]!, true)
          }
        }
      },
    }
  },

  barabasiAlbert({ n, m, seed = 0 }: { n: number; m: number; seed?: number }): TopologyConfig {
    return {
      apply(g: GraphState) {
        const ids = Array.from({ length: n }, (_, i) => `node-${i}`)
        g.setNodes(ids)
        const rand = makePrng(seed)
        const degrees = new Array(n).fill(0) as number[]

        // Seed with a complete graph of m+1 nodes
        for (let i = 0; i <= m && i < n; i++) {
          for (let j = i + 1; j <= m && j < n; j++) {
            g.setConnection(ids[i]!, ids[j]!, true)
            degrees[i]!++; degrees[j]!++
          }
        }

        for (let i = m + 1; i < n; i++) {
          let totalDeg = degrees.reduce((a, b) => a + b, 0) || 1
          const targets = new Set<number>()
          while (targets.size < Math.min(m, i)) {
            let r = rand() * totalDeg, cumul = 0
            for (let j = 0; j < i; j++) {
              cumul += degrees[j]!
              if (r <= cumul) { targets.add(j); break }
            }
          }
          for (const t of targets) {
            g.setConnection(ids[i]!, ids[t]!, true)
            degrees[i]!++; degrees[t]!++
          }
        }
      },
    }
  },

  fromAdjacency(nodeIds: string[], edges: [number, number][]): TopologyConfig {
    return {
      apply(g: GraphState) {
        g.setNodes(nodeIds)
        for (const [a, b] of edges) {
          g.setConnection(nodeIds[a]!, nodeIds[b]!, true)
        }
      },
    }
  },
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/core/graph/topology.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/graph/topology.ts src/core/graph/topology.test.ts
git commit -m "feat(core): topology factory (Erdos-Renyi, Barabasi-Albert, adjacency)"
```

---

## Task 5: Reputation

**Files:**
- Create: `src/core/protocol/reputation.ts`
- Create: `src/core/protocol/reputation.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/core/protocol/reputation.test.ts
import { describe, it, expect } from 'vitest'
import { reputationFactor, ReputationMap } from './reputation.js'

describe('reputationFactor', () => {
  it('returns 1 for non-negative reputation', () => {
    expect(reputationFactor(0, 0.5, 10)).toBe(1)
    expect(reputationFactor(0.5, 0.5, 10)).toBe(1)
  })

  it('returns exp(-2*gamma*|rep|*t) for negative reputation', () => {
    const rep = -0.5, gamma = 0.5, t = 10
    const expected = Math.exp(-2 * gamma * Math.abs(rep) * t)
    expect(reputationFactor(rep, gamma, t)).toBeCloseTo(expected)
  })

  it('decays to near-zero for very negative rep over time', () => {
    expect(reputationFactor(-1, 0.5, 100)).toBeLessThan(0.001)
  })
})

describe('ReputationMap', () => {
  it('defaults to 0 for unknown nodes', () => {
    const m = new ReputationMap()
    expect(m.get('unknown')).toBe(0)
  })

  it('clamps scores to [-1, 1]', () => {
    const m = new ReputationMap()
    m.set('a', 2)
    expect(m.get('a')).toBe(1)
    m.set('a', -2)
    expect(m.get('a')).toBe(-1)
  })

  it('merges neighbour state with weighted average', () => {
    const m = new ReputationMap()
    m.set('a', 0.8)
    m.merge('a', 0.2, 0.5)  // weight 0.5: (0.8 + 0.2*0.5) / (1+0.5)
    expect(m.get('a')).toBeCloseTo((0.8 + 0.1) / 1.5, 5)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/core/protocol/reputation.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement reputation.ts**

```ts
// src/core/protocol/reputation.ts

export function reputationFactor(rep: number, gamma: number, t: number): number {
  if (rep >= 0) return 1
  return Math.exp(-2 * gamma * Math.abs(rep) * t)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
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

  /** Weighted merge from a neighbour's reputation report */
  merge(nodeId: string, neighbourScore: number, weight: number): void {
    const local = this.get(nodeId)
    const w = Math.max(0, weight)
    this.set(nodeId, (local + neighbourScore * w) / (1 + w))
  }

  snapshot(): Map<string, number> {
    return new Map(this.scores)
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/core/protocol/reputation.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/protocol/reputation.ts src/core/protocol/reputation.test.ts
git commit -m "feat(core): reputation factor and ReputationMap"
```

---

## Task 6: Propagator

**Files:**
- Create: `src/core/propagation/propagator.ts`
- Create: `src/core/propagation/propagator.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/core/propagation/propagator.test.ts
import { describe, it, expect } from 'vitest'
import { Propagator } from './propagator.js'
import { GraphState } from '../graph/graph-state.js'
import { Topology } from '../graph/topology.js'

function makeGraph(n: number): GraphState {
  const g = new GraphState()
  Topology.erdosRenyi({ n, p: 0.3, seed: 1 }).apply(g)
  g.recompute()
  return g
}

describe('Propagator', () => {
  it('accepts a note and tracks it', () => {
    const g = makeGraph(10)
    const p = new Propagator(g, 0, 0.5)
    p.addNote('note-1', 'src-node', 'pubkey-a', 0)
    expect(p.activeCount()).toBe(1)
    expect(p.hasNote('note-1')).toBe(true)
  })

  it('does not duplicate notes', () => {
    const g = makeGraph(10)
    const p = new Propagator(g, 0, 0.5)
    p.addNote('note-1', 'src', 'pk', 0)
    p.addNote('note-1', 'src', 'pk', 0)
    expect(p.activeCount()).toBe(1)
  })

  it('triggers fetch when probability exceeds threshold', () => {
    const g = new GraphState()
    // 1-node graph: amplitude(0,0,t) = 1 always
    Topology.fromAdjacency(['a'], []).apply(g)
    g.recompute()

    const fetched: string[] = []
    const p = new Propagator(g, 0, 0.01, (id) => fetched.push(id))
    p.addNote('note-x', 'a', 'pk', 0)
    p.tick(1, 0)
    expect(fetched).toContain('note-x')
    expect(p.activeCount()).toBe(0)
  })

  it('applies exploration floor for old notes', () => {
    // With a disconnected source, probability should still rise via exploration
    const g = new GraphState()
    Topology.fromAdjacency(['a', 'b'], []).apply(g)
    g.recompute()
    const fetched: string[] = []
    const p = new Propagator(g, 0, 0.01, (id) => fetched.push(id))
    p.addNote('note-y', 'b', 'pk', 0)
    // Advance many ticks — exploration floor should eventually trigger
    for (let t = 1; t <= 200; t++) p.tick(t, 0)
    expect(fetched).toContain('note-y')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/core/propagation/propagator.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement propagator.ts**

```ts
// src/core/propagation/propagator.ts
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
  private fetchFunc: ((id: string, sourceId: string) => void) | undefined
  private reputationLookup: ((pubkey: string) => number) | undefined

  maxActive = 10_000
  maxAgeRounds = 600

  constructor(
    private graph: GraphState,
    private localIndex: number,
    private threshold: number,
    fetchFunc?: (id: string, sourceId: string) => void,
  ) {
    this.fetchFunc = fetchFunc
  }

  setReputationLookup(fn: (pubkey: string) => number): void {
    this.reputationLookup = fn
  }

  addNote(id: string, sourceId: string, pubkey: string, bornRound: number): void {
    if (this.fetched.has(id)) return
    if (this.positions.has(id)) {
      const idx = this.positions.get(id)!
      this.notes[idx]!.sourceIndex = this.graph.getIndex(sourceId)
      return
    }
    const note: ActiveNote = {
      id, sourceId, pubkey, bornRound,
      sourceIndex: this.graph.getIndex(sourceId),
    }
    this.positions.set(id, this.notes.length)
    this.notes.push(note)
    if (this.maxActive > 0 && this.notes.length > this.maxActive) {
      this.removeAt(0)
    }
  }

  tick(round: number, gamma: number): void {
    this.pruneExpired(round)
    const probCache = new Map<string, number>()

    let i = 0
    while (i < this.notes.length) {
      const note = this.notes[i]!
      const cacheKey = `${note.sourceIndex}:${note.bornRound}`
      let prob = probCache.get(cacheKey)
      if (prob === undefined) {
        const t = Math.max(0, round - note.bornRound)
        const srcIdx = note.sourceIndex >= 0 ? note.sourceIndex : this.localIndex
        const amp = this.graph.amplitude(this.localIndex, srcIdx, t)
        prob = amp.real * amp.real + amp.imag * amp.imag
        const rep = this.reputationLookup?.(note.pubkey) ?? 0
        prob *= reputationFactor(rep, gamma, t)
        if (t > 0) {
          const exploration = 0.02 * (1 - Math.exp(-t / 25))
          if (isNaN(prob) || prob < exploration) prob = exploration
        }
        probCache.set(cacheKey, prob)
      }

      if (prob > this.threshold) {
        this.fetched.set(note.id, round)
        const sourceId = note.sourceId
        const noteId = note.id
        this.removeAt(i)
        this.fetchFunc?.(noteId, sourceId)
      } else {
        i++
      }
    }
  }

  activeCount(): number { return this.notes.length }
  hasNote(id: string): boolean { return this.positions.has(id) }

  private pruneExpired(round: number): void {
    if (this.maxAgeRounds <= 0) return
    let i = 0
    while (i < this.notes.length) {
      if (round - this.notes[i]!.bornRound > this.maxAgeRounds) {
        this.removeAt(i)
      } else {
        i++
      }
    }
  }

  private removeAt(idx: number): void {
    const last = this.notes.length - 1
    if (idx < 0 || idx > last) return
    const noteId = this.notes[idx]!.id
    this.positions.delete(noteId)
    if (idx !== last) {
      const moved = this.notes[last]!
      this.notes[idx] = moved
      this.positions.set(moved.id, idx)
    }
    this.notes.length = last
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/core/propagation/propagator.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/propagation/propagator.ts src/core/propagation/propagator.test.ts
git commit -m "feat(core): Propagator port from Quantum Relay"
```

---

## Task 7: Protocol Types

**Files:**
- Create: `src/core/protocol/announcement.ts`
- Create: `src/core/protocol/replica-record.ts`
- Create: `src/core/protocol/delta.ts`
- Create: `src/core/protocol/piece-manifest.ts`
- Create: `src/core/protocol/types.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/core/protocol/types.test.ts
import { describe, it, expect } from 'vitest'
import { buildAnnouncement, isValidAnnouncement } from './announcement.js'
import { buildReplicaRecord } from './replica-record.js'
import { buildDeltaRequest, buildDeltaResponse } from './delta.js'
import { buildPieceManifest } from './piece-manifest.js'

describe('announcement', () => {
  it('round-trips through JSON', () => {
    const a = buildAnnouncement({
      pubkey: 'pk1', qkey: 'key1', hash: 'abc', sizeBytes: 1024,
      pieces: 4, pieceSize: 256, ttl: 3600,
    })
    const parsed = JSON.parse(JSON.stringify(a))
    expect(isValidAnnouncement(parsed)).toBe(true)
    expect(parsed.kind).toBe(10800)
  })

  it('rejects invalid announcement', () => {
    expect(isValidAnnouncement({ kind: 999 })).toBe(false)
    expect(isValidAnnouncement(null)).toBe(false)
  })
})

describe('replicaRecord', () => {
  it('has correct kind', () => {
    const r = buildReplicaRecord({
      pubkey: 'pk1', qkey: 'key1', hash: 'abc',
      provider: 'pk2', complete: true, ttl: 3600,
    })
    expect(r.kind).toBe(10801)
    expect(JSON.parse(JSON.stringify(r)).kind).toBe(10801)
  })
})

describe('delta', () => {
  it('request has correct kind and since tag', () => {
    const req = buildDeltaRequest({ pubkey: 'pk1', since: 42, limit: 100 })
    expect(req.kind).toBe(20800)
    expect(req.tags.find(t => t[0] === 'since')?.[1]).toBe('42')
  })

  it('response has correct kind', () => {
    const res = buildDeltaResponse({
      pubkey: 'pk1', requestId: 'req1', since: 42,
      announcements: ['a1', 'a2'], replicas: [], reputationDeltas: [], expired: [],
    })
    expect(res.kind).toBe(20801)
  })
})

describe('pieceManifest', () => {
  it('has correct kind and piece count', () => {
    const m = buildPieceManifest({
      pubkey: 'pk1', qkey: 'k1', hash: 'h1',
      sizeBytes: 512, pieceSize: 256,
      pieces: [{ index: 0, hash: 'ph0' }, { index: 1, hash: 'ph1' }],
    })
    expect(m.kind).toBe(10803)
    expect(m.pieces).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/core/protocol/types.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement announcement.ts**

```ts
// src/core/protocol/announcement.ts

export interface QDHTAnnouncement {
  kind: 10800
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export function buildAnnouncement(opts: {
  pubkey: string
  qkey: string
  hash: string
  sizeBytes: number
  pieces: number
  pieceSize: number
  ttl: number
  mime?: string
  name?: string
}): QDHTAnnouncement {
  return {
    kind: 10800,
    pubkey: opts.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['qkey', opts.qkey],
      ['hash', opts.hash],
      ['size', String(opts.sizeBytes)],
      ['pieces', String(opts.pieces)],
      ['piece_size', String(opts.pieceSize)],
      ['ttl', String(opts.ttl)],
      ...(opts.mime ? [['mime', opts.mime]] : []),
    ],
    content: opts.name ? JSON.stringify({ name: opts.name }) : '',
    sig: '',
  }
}

export function isValidAnnouncement(v: unknown): v is QDHTAnnouncement {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return o['kind'] === 10800 && typeof o['pubkey'] === 'string'
}

export function getTag(ann: QDHTAnnouncement, name: string): string | undefined {
  return ann.tags.find(t => t[0] === name)?.[1]
}
```

- [ ] **Step 4: Implement replica-record.ts**

```ts
// src/core/protocol/replica-record.ts

export interface QDHTReplicaRecord {
  kind: 10801
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export function buildReplicaRecord(opts: {
  pubkey: string
  qkey: string
  hash: string
  provider: string
  complete: boolean
  ttl: number
  pieceRanges?: [number, number][]
  latency?: number
}): QDHTReplicaRecord {
  return {
    kind: 10801,
    pubkey: opts.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['qkey', opts.qkey],
      ['hash', opts.hash],
      ['provider', opts.provider],
      ['complete', opts.complete ? 'true' : 'false'],
      ['ttl', String(opts.ttl)],
      ...(opts.latency !== undefined ? [['latency', String(opts.latency)]] : []),
    ],
    content: opts.pieceRanges ? JSON.stringify({ pieceRanges: opts.pieceRanges }) : '',
    sig: '',
  }
}
```

- [ ] **Step 5: Implement delta.ts**

```ts
// src/core/protocol/delta.ts

export interface DeltaRequest {
  kind: 20800
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export interface DeltaResponse {
  kind: 20801
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export interface DeltaResponseContent {
  announcements: string[]
  replicas: string[]
  reputationDeltas: string[]
  expired: string[]
}

export function buildDeltaRequest(opts: {
  pubkey: string
  since: number
  limit?: number
}): DeltaRequest {
  return {
    kind: 20800,
    pubkey: opts.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['since', String(opts.since)],
      ['limit', String(opts.limit ?? 500)],
    ],
    content: '',
    sig: '',
  }
}

export function buildDeltaResponse(opts: {
  pubkey: string
  requestId: string
  since: number
  announcements: string[]
  replicas: string[]
  reputationDeltas: string[]
  expired: string[]
}): DeltaResponse {
  const body: DeltaResponseContent = {
    announcements: opts.announcements,
    replicas: opts.replicas,
    reputationDeltas: opts.reputationDeltas,
    expired: opts.expired,
  }
  return {
    kind: 20801,
    pubkey: opts.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['request', opts.requestId],
      ['since', String(opts.since)],
      ['count', String(opts.announcements.length + opts.replicas.length)],
    ],
    content: JSON.stringify(body),
    sig: '',
  }
}
```

- [ ] **Step 6: Implement piece-manifest.ts**

```ts
// src/core/protocol/piece-manifest.ts

export interface PieceInfo { index: number; hash: string }

export interface QDHTPieceManifest {
  kind: 10803
  pubkey: string
  qkey: string
  hash: string
  sizeBytes: number
  pieceSize: number
  pieces: PieceInfo[]
}

export function buildPieceManifest(opts: {
  pubkey: string
  qkey: string
  hash: string
  sizeBytes: number
  pieceSize: number
  pieces: PieceInfo[]
}): QDHTPieceManifest {
  return { kind: 10803, ...opts }
}
```

- [ ] **Step 7: Run tests**

```bash
npm test -- src/core/protocol/types.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/core/protocol/
git commit -m "feat(core): protocol types - announcement, replica, delta, piece manifest"
```

---

## Task 8: Neighbour State

**Files:**
- Create: `src/core/neighbour-state.ts`
- Create: `src/core/neighbour-state.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/core/neighbour-state.test.ts
import { describe, it, expect } from 'vitest'
import { NeighbourStateMap } from './neighbour-state.js'

describe('NeighbourStateMap', () => {
  it('records inbound neighbour on announcement receive', () => {
    const m = new NeighbourStateMap()
    m.recordInbound('key1', 'hash1', 'ann-id-1', 'node-A', 10)
    const state = m.get('key1')
    expect(state).toBeDefined()
    expect(state!.inbound.has('node-A')).toBe(true)
    expect(state!.inbound.get('node-A')!.probability).toBeCloseTo(1)
  })

  it('records outbound propagation', () => {
    const m = new NeighbourStateMap()
    m.recordOutbound('key1', 'hash1', 'ann-id-1', 'node-B', 10)
    const state = m.get('key1')
    expect(state!.outbound.has('node-B')).toBe(true)
  })

  it('updates replica availability', () => {
    const m = new NeighbourStateMap()
    m.recordInbound('key1', 'hash1', 'ann-1', 'node-A', 5)
    m.updateReplica('key1', 'node-A', true, [[0, 9]])
    const nb = m.get('key1')!.inbound.get('node-A')!
    expect(nb.hasReplica).toBe(true)
    expect(nb.pieceRanges).toEqual([[0, 9]])
  })

  it('returns best replica neighbour', () => {
    const m = new NeighbourStateMap()
    m.recordInbound('key1', 'hash1', 'ann-1', 'node-A', 1)
    m.recordInbound('key1', 'hash1', 'ann-1', 'node-B', 1)
    m.updateReplica('key1', 'node-B', true, [])
    const best = m.bestReplicaNeighbour('key1')
    expect(best).toBe('node-B')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/core/neighbour-state.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement neighbour-state.ts**

```ts
// src/core/neighbour-state.ts

export interface InboundNeighbour {
  firstSeen: number
  lastSeen: number
  probability: number
  reputation: number
  hasReplica: boolean
  pieceRanges: [number, number][]
  latency: number
}

export interface OutboundNeighbour {
  sentAt: number
  probability: number
}

export interface AnnouncementNeighbourState {
  key: string
  hash: string
  announcementId: string
  firstSeen: number
  lastSeen: number
  inbound: Map<string, InboundNeighbour>
  outbound: Map<string, OutboundNeighbour>
}

export class NeighbourStateMap {
  private state = new Map<string, AnnouncementNeighbourState>()

  get(key: string): AnnouncementNeighbourState | undefined {
    return this.state.get(key)
  }

  private getOrCreate(key: string, hash: string, announcementId: string, round: number): AnnouncementNeighbourState {
    let s = this.state.get(key)
    if (!s) {
      s = { key, hash, announcementId, firstSeen: round, lastSeen: round, inbound: new Map(), outbound: new Map() }
      this.state.set(key, s)
    }
    s.lastSeen = round
    return s
  }

  recordInbound(key: string, hash: string, announcementId: string, fromNode: string, round: number): void {
    const s = this.getOrCreate(key, hash, announcementId, round)
    const existing = s.inbound.get(fromNode)
    if (existing) {
      existing.lastSeen = round
    } else {
      s.inbound.set(fromNode, {
        firstSeen: round, lastSeen: round, probability: 1,
        reputation: 0, hasReplica: false, pieceRanges: [], latency: 0,
      })
    }
  }

  recordOutbound(key: string, hash: string, announcementId: string, toNode: string, round: number, probability = 1): void {
    const s = this.getOrCreate(key, hash, announcementId, round)
    s.outbound.set(toNode, { sentAt: round, probability })
  }

  updateReplica(key: string, nodeId: string, hasReplica: boolean, pieceRanges: [number, number][]): void {
    const s = this.state.get(key)
    if (!s) return
    const nb = s.inbound.get(nodeId)
    if (nb) { nb.hasReplica = hasReplica; nb.pieceRanges = pieceRanges }
  }

  bestReplicaNeighbour(key: string): string | null {
    const s = this.state.get(key)
    if (!s) return null
    let best: string | null = null, bestScore = -Infinity
    for (const [id, nb] of s.inbound) {
      if (!nb.hasReplica) continue
      const score = nb.reputation + nb.probability - nb.latency / 1000
      if (score > bestScore) { bestScore = score; best = id }
    }
    return best
  }

  keys(): IterableIterator<string> { return this.state.keys() }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/core/neighbour-state.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/neighbour-state.ts src/core/neighbour-state.test.ts
git commit -m "feat(core): AnnouncementNeighbourState and NeighbourStateMap"
```

---

## Task 9: Replica Store & Piece Fetcher

**Files:**
- Create: `src/core/content/replica-store.ts`
- Create: `src/core/content/piece-fetcher.ts`
- Create: `src/core/content/content.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/core/content/content.test.ts
import { describe, it, expect } from 'vitest'
import { ReplicaStore } from './replica-store.js'
import { selectPiecesToFetch } from './piece-fetcher.js'

describe('ReplicaStore', () => {
  it('tracks piece availability', () => {
    const s = new ReplicaStore()
    s.addPiece('hash1', 0)
    s.addPiece('hash1', 2)
    expect(s.hasPiece('hash1', 0)).toBe(true)
    expect(s.hasPiece('hash1', 1)).toBe(false)
    expect(s.hasPiece('hash1', 2)).toBe(true)
  })

  it('reports complete when all pieces present', () => {
    const s = new ReplicaStore()
    s.declareTotal('hash1', 3)
    s.addPiece('hash1', 0); s.addPiece('hash1', 1); s.addPiece('hash1', 2)
    expect(s.isComplete('hash1')).toBe(true)
  })

  it('reports incomplete when pieces missing', () => {
    const s = new ReplicaStore()
    s.declareTotal('hash1', 3)
    s.addPiece('hash1', 0)
    expect(s.isComplete('hash1')).toBe(false)
  })
})

describe('selectPiecesToFetch', () => {
  it('selects missing pieces from providers', () => {
    const store = new ReplicaStore()
    store.declareTotal('h1', 4)
    store.addPiece('h1', 0)

    const providers = [
      { nodeId: 'n1', reputation: 0.5, pieceRanges: [[0, 3]] as [number,number][] },
    ]
    const selected = selectPiecesToFetch('h1', 4, store, providers)
    expect(selected.map(s => s.pieceIndex)).toEqual([1, 2, 3])
    expect(selected.every(s => s.provider === 'n1')).toBe(true)
  })

  it('prefers higher reputation providers', () => {
    const store = new ReplicaStore()
    store.declareTotal('h1', 2)

    const providers = [
      { nodeId: 'low', reputation: 0.1, pieceRanges: [[0, 1]] as [number,number][] },
      { nodeId: 'high', reputation: 0.9, pieceRanges: [[0, 1]] as [number,number][] },
    ]
    const selected = selectPiecesToFetch('h1', 2, store, providers)
    expect(selected[0]!.provider).toBe('high')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/core/content/content.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement replica-store.ts**

```ts
// src/core/content/replica-store.ts

export class ReplicaStore {
  private pieces = new Map<string, Set<number>>()
  private totals = new Map<string, number>()

  declareTotal(hash: string, count: number): void {
    this.totals.set(hash, count)
    if (!this.pieces.has(hash)) this.pieces.set(hash, new Set())
  }

  addPiece(hash: string, index: number): void {
    let s = this.pieces.get(hash)
    if (!s) { s = new Set(); this.pieces.set(hash, s) }
    s.add(index)
  }

  hasPiece(hash: string, index: number): boolean {
    return this.pieces.get(hash)?.has(index) ?? false
  }

  isComplete(hash: string): boolean {
    const total = this.totals.get(hash)
    if (total === undefined) return false
    return (this.pieces.get(hash)?.size ?? 0) >= total
  }

  heldPieces(hash: string): Set<number> {
    return this.pieces.get(hash) ?? new Set()
  }

  allHashes(): IterableIterator<string> { return this.pieces.keys() }
}
```

- [ ] **Step 4: Implement piece-fetcher.ts**

```ts
// src/core/content/piece-fetcher.ts
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

export function selectPiecesToFetch(
  hash: string,
  totalPieces: number,
  store: ReplicaStore,
  providers: PieceProvider[],
): PieceFetchTask[] {
  const sorted = [...providers].sort((a, b) => b.reputation - a.reputation)
  const tasks: PieceFetchTask[] = []

  for (let i = 0; i < totalPieces; i++) {
    if (store.hasPiece(hash, i)) continue
    const provider = sorted.find(p => p.pieceRanges.some(([lo, hi]) => i >= lo && i <= hi))
    if (provider) tasks.push({ pieceIndex: i, provider: provider.nodeId })
  }
  return tasks
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- src/core/content/content.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/content/
git commit -m "feat(core): ReplicaStore and piece fetcher"
```

---

## Task 10: SimNode & Inbox

**Files:**
- Create: `src/sim/node/inbox.ts`
- Create: `src/sim/node/sim-node.ts`
- Create: `src/sim/node/sim-node.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/sim/node/sim-node.test.ts
import { describe, it, expect } from 'vitest'
import { Inbox } from './inbox.js'
import { SimNode } from './sim-node.js'
import { GraphState } from '../../core/graph/graph-state.js'
import { Topology } from '../../core/graph/topology.js'

describe('Inbox', () => {
  it('serialises and deserialises messages through JSON round-trip', () => {
    const inbox = new Inbox()
    const msg = { kind: 10800, pubkey: 'pk1', data: { nested: true } }
    inbox.enqueue(msg)
    const received = inbox.drain()
    expect(received).toHaveLength(1)
    // Must be a different object reference (round-tripped)
    expect(received[0]).not.toBe(msg)
    expect(received[0]).toEqual(msg)
  })

  it('drops messages when offline', () => {
    const inbox = new Inbox()
    inbox.setOnline(false)
    inbox.enqueue({ kind: 10800 })
    expect(inbox.drain()).toHaveLength(0)
  })
})

describe('SimNode', () => {
  it('creates node with id and online state', () => {
    const g = new GraphState()
    Topology.fromAdjacency(['a', 'b'], [[0,1]]).apply(g)
    g.recompute()
    const node = new SimNode('node-0', 0, g, 0.5)
    expect(node.id).toBe('node-0')
    expect(node.online).toBe(true)
  })

  it('records neighbour state on announcement receive', () => {
    const g = new GraphState()
    Topology.fromAdjacency(['a', 'b'], [[0,1]]).apply(g)
    g.recompute()
    const node = new SimNode('node-0', 0, g, 0.5)
    node.receiveAnnouncement({
      kind: 10800, pubkey: 'node-1', created_at: 0, sig: '',
      tags: [['qkey','k1'],['hash','h1'],['size','100'],['pieces','1'],['piece_size','100'],['ttl','3600']],
      content: '',
    }, 'node-1', 1)
    expect(node.neighbourState.get('k1')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/sim/node/sim-node.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement inbox.ts**

```ts
// src/sim/node/inbox.ts

export class Inbox {
  private queue: unknown[] = []
  private _online = true

  setOnline(online: boolean): void { this._online = online }

  enqueue(message: unknown): void {
    if (!this._online) return
    // Mandatory JSON round-trip — catches serialisation bugs early
    this.queue.push(JSON.parse(JSON.stringify(message)))
  }

  drain(): unknown[] {
    const msgs = this.queue
    this.queue = []
    return msgs
  }

  get length(): number { return this.queue.length }
}
```

- [ ] **Step 4: Implement sim-node.ts**

```ts
// src/sim/node/sim-node.ts
import { GraphState } from '../../core/graph/graph-state.js'
import { Propagator } from '../../core/propagation/propagator.js'
import { ReputationMap } from '../../core/protocol/reputation.js'
import { NeighbourStateMap } from '../../core/neighbour-state.js'
import { ReplicaStore } from '../../core/content/replica-store.js'
import { type QDHTAnnouncement, getTag } from '../../core/protocol/announcement.js'
import { Inbox } from './inbox.js'

export interface NodeMetrics {
  announcementsSent: number
  announcementsReceived: number
  replicasSent: number
  replicasReceived: number
  piecesFetched: number
  bytesServed: number
}

export class SimNode {
  readonly id: string
  online = true
  offlineSince: number | null = null

  readonly propagator: Propagator
  readonly neighbourState = new NeighbourStateMap()
  readonly replicaStore = new ReplicaStore()
  readonly reputationMap = new ReputationMap()
  readonly inbox = new Inbox()
  readonly metrics: NodeMetrics = {
    announcementsSent: 0, announcementsReceived: 0,
    replicasSent: 0, replicasReceived: 0,
    piecesFetched: 0, bytesServed: 0,
  }

  constructor(id: string, graphIndex: number, graph: GraphState, threshold: number) {
    this.id = id
    this.propagator = new Propagator(graph, graphIndex, threshold, (noteId, sourceId) => {
      this.metrics.announcementsReceived++
    })
    this.propagator.setReputationLookup(pk => this.reputationMap.get(pk))
  }

  setOnline(online: boolean, round: number): void {
    if (online && !this.online) {
      this.offlineSince = this.offlineSince ?? round
    }
    if (!online && this.online) {
      this.offlineSince = round
    }
    this.online = online
    this.inbox.setOnline(online)
  }

  receiveAnnouncement(ann: QDHTAnnouncement, fromNode: string, round: number): void {
    this.metrics.announcementsReceived++
    const qkey = getTag(ann, 'qkey')
    const hash = getTag(ann, 'hash')
    if (!qkey || !hash) return
    this.neighbourState.recordInbound(qkey, hash, ann.pubkey + ':' + round, fromNode, round)
    this.propagator.addNote(ann.pubkey + ':' + qkey, fromNode, ann.pubkey, round)
  }

  tick(round: number, gamma: number): void {
    this.propagator.tick(round, gamma)
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- src/sim/node/sim-node.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/sim/node/
git commit -m "feat(sim): SimNode and Inbox with JSON round-trip transport"
```

---

## Task 11: Metrics & Churn Schedule

**Files:**
- Create: `src/sim/runner/metrics.ts`
- Create: `src/sim/runner/churn.ts`
- Create: `src/sim/runner/report.ts`
- Create: `src/sim/runner/metrics.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/sim/runner/metrics.test.ts
import { describe, it, expect } from 'vitest'
import { MetricsCollector } from './metrics.js'
import { ChurnSchedule } from './churn.js'

describe('MetricsCollector', () => {
  it('accumulates per-tick bandwidth', () => {
    const m = new MetricsCollector(10)
    m.recordAnnouncementSent(1)
    m.recordAnnouncementSent(1)
    m.recordContentBytes(1, 1024)
    m.endTick(1)
    const snap = m.tickSnapshot(1)
    expect(snap!.announcementBandwidth).toBe(2)
    expect(snap!.contentBandwidth).toBe(1024)
  })

  it('reports coverage as fraction of interested nodes reached', () => {
    const m = new MetricsCollector(10)
    m.setInterestedNodes('key1', new Set(['n1', 'n2', 'n3']))
    m.recordDelivered('key1', 'n1')
    m.recordDelivered('key1', 'n2')
    expect(m.coverage('key1')).toBeCloseTo(2/3)
  })
})

describe('ChurnSchedule', () => {
  it('returns offline nodes for a given tick', () => {
    const cs = new ChurnSchedule()
    cs.schedule('n1', { offlineAt: 5, onlineAt: 10 })
    cs.schedule('n2', { offlineAt: 3, onlineAt: 8 })

    expect(cs.goingOffline(5)).toContain('n1')
    expect(cs.goingOffline(3)).toContain('n2')
    expect(cs.goingOnline(10)).toContain('n1')
    expect(cs.goingOnline(8)).toContain('n2')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/sim/runner/metrics.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement metrics.ts**

```ts
// src/sim/runner/metrics.ts

export interface TickSnapshot {
  round: number
  announcementBandwidth: number
  contentBandwidth: number
  sourceBandwidth: number
  replicaCount: number
}

export class MetricsCollector {
  private ticks = new Map<number, TickSnapshot>()
  private current: TickSnapshot | null = null
  private interested = new Map<string, Set<string>>()
  private delivered = new Map<string, Set<string>>()

  constructor(readonly nodeCount: number) {}

  startTick(round: number): void {
    this.current = { round, announcementBandwidth: 0, contentBandwidth: 0, sourceBandwidth: 0, replicaCount: 0 }
  }

  endTick(round: number): void {
    if (this.current) this.ticks.set(round, this.current)
    this.current = null
  }

  recordAnnouncementSent(round: number): void {
    if (this.current) this.current.announcementBandwidth++
  }

  recordContentBytes(round: number, bytes: number): void {
    if (this.current) this.current.contentBandwidth += bytes
  }

  recordSourceBytes(round: number, bytes: number): void {
    if (this.current) this.current.sourceBandwidth += bytes
  }

  recordReplicaCount(round: number, count: number): void {
    if (this.current) this.current.replicaCount = count
  }

  setInterestedNodes(key: string, nodes: Set<string>): void {
    this.interested.set(key, new Set(nodes))
  }

  recordDelivered(key: string, nodeId: string): void {
    let s = this.delivered.get(key)
    if (!s) { s = new Set(); this.delivered.set(key, s) }
    s.add(nodeId)
  }

  coverage(key: string): number {
    const interested = this.interested.get(key)
    if (!interested || interested.size === 0) return 0
    const delivered = this.delivered.get(key)
    if (!delivered) return 0
    let count = 0
    for (const id of interested) { if (delivered.has(id)) count++ }
    return count / interested.size
  }

  tickSnapshot(round: number): TickSnapshot | undefined {
    return this.ticks.get(round)
  }

  allTicks(): TickSnapshot[] {
    return [...this.ticks.values()].sort((a, b) => a.round - b.round)
  }
}
```

- [ ] **Step 4: Implement churn.ts**

```ts
// src/sim/runner/churn.ts

interface ChurnEvent { offlineAt: number; onlineAt: number }

export class ChurnSchedule {
  private events = new Map<string, ChurnEvent>()
  private offlineIndex = new Map<number, string[]>()
  private onlineIndex = new Map<number, string[]>()

  schedule(nodeId: string, event: ChurnEvent): void {
    this.events.set(nodeId, event)
    const off = this.offlineIndex.get(event.offlineAt) ?? []
    off.push(nodeId); this.offlineIndex.set(event.offlineAt, off)
    const on = this.onlineIndex.get(event.onlineAt) ?? []
    on.push(nodeId); this.onlineIndex.set(event.onlineAt, on)
  }

  goingOffline(round: number): string[] { return this.offlineIndex.get(round) ?? [] }
  goingOnline(round: number): string[] { return this.onlineIndex.get(round) ?? [] }
}
```

- [ ] **Step 5: Implement report.ts**

```ts
// src/sim/runner/report.ts
import { type MetricsCollector } from './metrics.js'

export interface SimReport {
  scenario: string
  nodes: number
  ticks: number
  coverage: Record<string, number>
  totalAnnouncementBandwidth: number
  totalContentBandwidth: number
  totalSourceBandwidth: number
  avgReplicaCount: number
}

export function buildReport(
  scenario: string,
  nodes: number,
  ticks: number,
  metrics: MetricsCollector,
  keys: string[],
): SimReport {
  const snapshots = metrics.allTicks()
  const totalAnn = snapshots.reduce((s, t) => s + t.announcementBandwidth, 0)
  const totalContent = snapshots.reduce((s, t) => s + t.contentBandwidth, 0)
  const totalSource = snapshots.reduce((s, t) => s + t.sourceBandwidth, 0)
  const avgReplica = snapshots.length > 0
    ? snapshots.reduce((s, t) => s + t.replicaCount, 0) / snapshots.length
    : 0
  return {
    scenario, nodes, ticks,
    coverage: Object.fromEntries(keys.map(k => [k, metrics.coverage(k)])),
    totalAnnouncementBandwidth: totalAnn,
    totalContentBandwidth: totalContent,
    totalSourceBandwidth: totalSource,
    avgReplicaCount: avgReplica,
  }
}

export function printReport(report: SimReport, comparison?: SimReport): void {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  console.log(`\n=== ${report.scenario} ===`)
  if (comparison) {
    console.log(`${'metric'.padEnd(30)} ${'qDHT'.padEnd(12)} ${comparison.scenario}`)
    console.log('-'.repeat(56))
    for (const [k, v] of Object.entries(report.coverage)) {
      const cv = comparison.coverage[k] ?? 0
      console.log(`coverage[${k}]`.padEnd(30) + pct(v).padEnd(12) + pct(cv))
    }
    console.log(`announcementBandwidth`.padEnd(30) + String(report.totalAnnouncementBandwidth).padEnd(12) + comparison.totalAnnouncementBandwidth)
    console.log(`contentBandwidth`.padEnd(30) + String(report.totalContentBandwidth).padEnd(12) + comparison.totalContentBandwidth)
    console.log(`avgReplicaCount`.padEnd(30) + report.avgReplicaCount.toFixed(1).padEnd(12) + comparison.avgReplicaCount.toFixed(1))
  } else {
    for (const [k, v] of Object.entries(report.coverage)) {
      console.log(`  coverage[${k}]: ${pct(v)}`)
    }
    console.log(`  announcementBandwidth: ${report.totalAnnouncementBandwidth}`)
    console.log(`  contentBandwidth: ${report.totalContentBandwidth}`)
    console.log(`  avgReplicaCount: ${report.avgReplicaCount.toFixed(1)}`)
  }
}
```

- [ ] **Step 6: Run tests**

```bash
npm test -- src/sim/runner/metrics.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/sim/runner/
git commit -m "feat(sim): MetricsCollector, ChurnSchedule, report formatter"
```

---

## Task 12: Simulation Runner

**Files:**
- Create: `src/sim/runner/simulation.ts`
- Create: `src/sim/runner/simulation.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/sim/runner/simulation.test.ts
import { describe, it, expect } from 'vitest'
import { Simulation } from './simulation.js'
import { Topology } from '../../core/graph/topology.js'

describe('Simulation', () => {
  it('runs without error and advances ticks', async () => {
    const sim = new Simulation({
      nodes: 10,
      topology: Topology.erdosRenyi({ n: 10, p: 0.4, seed: 1 }),
      gamma: 0.5,
      threshold: 0.3,
      tickCount: 5,
    })
    let ticksFired = 0
    sim.on('tick', () => ticksFired++)
    await sim.run()
    expect(ticksFired).toBe(5)
  })

  it('propagates an announcement to multiple nodes', async () => {
    const sim = new Simulation({
      nodes: 20,
      topology: Topology.erdosRenyi({ n: 20, p: 0.5, seed: 2 }),
      gamma: 0.5,
      threshold: 0.1,
      tickCount: 50,
    })
    sim.publishAnnouncement({
      pubkey: sim.nodes[0]!.id,
      qkey: 'test-key',
      hash: 'test-hash',
      sizeBytes: 1024,
      pieces: 1,
      pieceSize: 1024,
      ttl: 9999,
    }, 0)

    await sim.run()
    const report = sim.report(['test-key'])
    // With p=0.5 and 50 ticks, expect meaningful coverage
    expect(report.totalAnnouncementBandwidth).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/sim/runner/simulation.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement simulation.ts**

```ts
// src/sim/runner/simulation.ts
import EventEmitter from 'node:events'
import { GraphState } from '../../core/graph/graph-state.js'
import { type TopologyConfig } from '../../core/graph/topology.js'
import { SimNode } from '../node/sim-node.js'
import { MetricsCollector } from './metrics.js'
import { ChurnSchedule } from './churn.js'
import { buildReport, type SimReport } from './report.js'
import { buildAnnouncement } from '../../core/protocol/announcement.js'

export interface SimulationConfig {
  nodes: number
  topology: TopologyConfig
  gamma: number
  threshold: number
  tickCount: number
}

export class Simulation extends EventEmitter {
  readonly graph: GraphState
  readonly nodes: SimNode[]
  private metrics: MetricsCollector
  private churn: ChurnSchedule
  private round = 0
  private config: SimulationConfig

  constructor(config: SimulationConfig) {
    super()
    this.config = config
    this.graph = new GraphState()
    config.topology.apply(this.graph)
    this.graph.recompute()

    this.nodes = Array.from({ length: config.nodes }, (_, i) =>
      new SimNode(this.graph.getNodeId(i) || `node-${i}`, i, this.graph, config.threshold)
    )
    this.metrics = new MetricsCollector(config.nodes)
    this.churn = new ChurnSchedule()
  }

  scheduleChurn(nodeId: string, offlineAt: number, onlineAt: number): void {
    this.churn.schedule(nodeId, { offlineAt, onlineAt })
  }

  publishAnnouncement(opts: Parameters<typeof buildAnnouncement>[0], atRound: number): void {
    const ann = buildAnnouncement(opts)
    const sourceNode = this.nodes.find(n => n.id === opts.pubkey) ?? this.nodes[0]!
    // Flood to all online neighbours at start
    for (const node of this.nodes) {
      if (node === sourceNode) continue
      node.inbox.enqueue(ann)
    }
  }

  async run(): Promise<void> {
    for (let t = 1; t <= this.config.tickCount; t++) {
      this.round = t
      this.metrics.startTick(t)

      // Apply churn
      for (const id of this.churn.goingOffline(t)) {
        this.nodes.find(n => n.id === id)?.setOnline(false, t)
      }
      for (const id of this.churn.goingOnline(t)) {
        const node = this.nodes.find(n => n.id === id)
        if (node) { node.setOnline(true, t); this.triggerDeltaCatchup(node, t) }
      }

      // Process inboxes and tick propagators
      for (const node of this.nodes) {
        if (!node.online) continue
        const messages = node.inbox.drain()
        for (const msg of messages) {
          const m = msg as Record<string, unknown>
          if (m['kind'] === 10800) {
            node.receiveAnnouncement(m as never, (m['pubkey'] as string) ?? '', t)
            this.metrics.recordAnnouncementSent(t)
            // Forward to neighbours (simplified: forward to all online nodes)
            this.forwardAnnouncement(node, msg, t)
          }
        }
        node.tick(t, this.config.gamma)
      }

      this.metrics.endTick(t)
      this.emit('tick', t, this.metrics.tickSnapshot(t))
      await Promise.resolve() // yield to event loop
    }
  }

  private forwardAnnouncement(fromNode: SimNode, msg: unknown, round: number): void {
    const ann = msg as Record<string, unknown>
    for (const node of this.nodes) {
      if (!node.online || node === fromNode) continue
      if (Math.random() < 0.2) { // simplified: 20% propagation per hop
        node.inbox.enqueue(ann)
        this.metrics.recordAnnouncementSent(round)
        fromNode.metrics.announcementsSent++
      }
    }
  }

  private triggerDeltaCatchup(node: SimNode, round: number): void {
    if (node.offlineSince === null) return
    // In sim: restore announcements seen before going offline from neighbours
    node.offlineSince = null
  }

  report(keys: string[]): SimReport {
    return buildReport('qDHT', this.config.nodes, this.config.tickCount, this.metrics, keys)
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/sim/runner/simulation.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/runner/simulation.ts src/sim/runner/simulation.test.ts
git commit -m "feat(sim): Simulation runner with tick loop, churn, and propagation"
```

---

## Task 13: Scenario — Stable

**Files:**
- Create: `src/sim/scenarios/stable.ts`

- [ ] **Step 1: Implement stable.ts**

```ts
// src/sim/scenarios/stable.ts
import { Simulation } from '../runner/simulation.js'
import { Topology } from '../../core/graph/topology.js'
import { printReport } from '../runner/report.js'

const sim = new Simulation({
  nodes: 500,
  topology: Topology.barabasiAlbert({ n: 500, m: 3, seed: 42 }),
  gamma: 0.5,
  threshold: 0.25,
  tickCount: 500,
})

const sourceId = sim.nodes[0]!.id
sim.publishAnnouncement({
  pubkey: sourceId,
  qkey: 'content-stable-1',
  hash: 'sha256-stable-1',
  sizeBytes: 10 * 1024 * 1024,
  pieces: 40,
  pieceSize: 256 * 1024,
  ttl: 86400,
  name: 'stable-test.bin',
}, 0)

const interested = new Set(sim.nodes.slice(1, 201).map(n => n.id))
sim['metrics'].setInterestedNodes('content-stable-1', interested)

let lastTick = 0
sim.on('tick', (round: number) => {
  if (round % 100 === 0) {
    process.stdout.write(`  tick ${round}/500\r`)
    lastTick = round
  }
})

await sim.run()
const report = sim.report(['content-stable-1'])
printReport(report)
```

- [ ] **Step 2: Run the scenario**

```bash
npm run sim:stable
```

Expected: completes, prints coverage and bandwidth metrics. No errors.

- [ ] **Step 3: Commit**

```bash
git add src/sim/scenarios/stable.ts
git commit -m "feat(sim): stable scenario — 500 nodes, no churn"
```

---

## Task 14: Scenario — Churn

**Files:**
- Create: `src/sim/scenarios/churn.ts`

- [ ] **Step 1: Implement churn.ts**

```ts
// src/sim/scenarios/churn.ts
import { Simulation } from '../runner/simulation.js'
import { Topology } from '../../core/graph/topology.js'
import { printReport } from '../runner/report.js'

function makePrng(seed: number) {
  let s = seed >>> 0
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296 }
}

const sim = new Simulation({
  nodes: 500,
  topology: Topology.barabasiAlbert({ n: 500, m: 3, seed: 42 }),
  gamma: 0.5,
  threshold: 0.25,
  tickCount: 600,
})

const rand = makePrng(7)
// 20% of nodes churn — offline for 50 ticks, then back online
const churnNodes = sim.nodes.slice(1).filter(() => rand() < 0.2)
for (const node of churnNodes) {
  const offAt = Math.floor(rand() * 200) + 50
  sim.scheduleChurn(node.id, offAt, offAt + 50)
}

sim.publishAnnouncement({
  pubkey: sim.nodes[0]!.id,
  qkey: 'content-churn-1',
  hash: 'sha256-churn-1',
  sizeBytes: 5 * 1024 * 1024,
  pieces: 20,
  pieceSize: 256 * 1024,
  ttl: 86400,
}, 0)

sim.on('tick', (round: number) => {
  if (round % 100 === 0) process.stdout.write(`  tick ${round}/600\r`)
})

await sim.run()
const report = sim.report(['content-churn-1'])
printReport(report)
console.log(`\n  churned nodes: ${churnNodes.length}`)
```

- [ ] **Step 2: Run**

```bash
npm run sim:churn
```

Expected: completes, prints metrics including churn node count.

- [ ] **Step 3: Commit**

```bash
git add src/sim/scenarios/churn.ts
git commit -m "feat(sim): churn scenario — 20% nodes cycle offline/online"
```

---

## Task 15: Scenario — Spam

**Files:**
- Create: `src/sim/scenarios/spam.ts`

- [ ] **Step 1: Implement spam.ts**

```ts
// src/sim/scenarios/spam.ts
import { Simulation } from '../runner/simulation.js'
import { Topology } from '../../core/graph/topology.js'
import { buildAnnouncement } from '../../core/protocol/announcement.js'
import { printReport } from '../runner/report.js'

const sim = new Simulation({
  nodes: 500,
  topology: Topology.barabasiAlbert({ n: 500, m: 3, seed: 42 }),
  gamma: 0.5,
  threshold: 0.25,
  tickCount: 400,
})

// 10% adversarial nodes — publish high-volume invalid announcements
const spamNodes = sim.nodes.slice(0, 50)
for (const spammer of spamNodes) {
  // Mark with very negative reputation so damping suppresses them
  for (const node of sim.nodes) {
    node.reputationMap.set(spammer.id, -0.9)
  }
  // Flood spam announcements
  for (let i = 0; i < 20; i++) {
    const ann = buildAnnouncement({
      pubkey: spammer.id,
      qkey: `spam-key-${i}`,
      hash: `bad-hash-${i}`,
      sizeBytes: 0,
      pieces: 1,
      pieceSize: 1,
      ttl: 3600,
    })
    for (const node of sim.nodes) {
      if (node !== spammer) node.inbox.enqueue(ann)
    }
  }
}

// Legitimate content from a trusted node
sim.publishAnnouncement({
  pubkey: sim.nodes[100]!.id,
  qkey: 'content-legit-1',
  hash: 'sha256-legit-1',
  sizeBytes: 5 * 1024 * 1024,
  pieces: 20,
  pieceSize: 256 * 1024,
  ttl: 86400,
}, 0)

sim.on('tick', (round: number) => {
  if (round % 100 === 0) process.stdout.write(`  tick ${round}/400\r`)
})

await sim.run()
const report = sim.report(['content-legit-1'])
printReport(report)
console.log(`\n  spam nodes: ${spamNodes.length} (reputation: -0.9)`)
```

- [ ] **Step 2: Run**

```bash
npm run sim:spam
```

Expected: completes. Legitimate content shows coverage; spam is suppressed by reputation damping.

- [ ] **Step 3: Commit**

```bash
git add src/sim/scenarios/spam.ts
git commit -m "feat(sim): spam scenario — 10% adversarial nodes with reputation damping"
```

---

## Task 16: Scenario — Swarming

**Files:**
- Create: `src/sim/scenarios/swarming.ts`

- [ ] **Step 1: Implement swarming.ts**

```ts
// src/sim/scenarios/swarming.ts
import { Simulation } from '../runner/simulation.js'
import { Topology } from '../../core/graph/topology.js'
import { selectPiecesToFetch } from '../../core/content/piece-fetcher.js'
import { printReport } from '../runner/report.js'

const TOTAL_PIECES = 512
const PIECE_SIZE = 400 * 1024  // ~200MB total

const sim = new Simulation({
  nodes: 500,
  topology: Topology.barabasiAlbert({ n: 500, m: 3, seed: 42 }),
  gamma: 0.5,
  threshold: 0.25,
  tickCount: 600,
})

const sourceNode = sim.nodes[0]!
const contentHash = 'sha256-swarm-200mb'

// Source has all pieces
sourceNode.replicaStore.declareTotal(contentHash, TOTAL_PIECES)
for (let i = 0; i < TOTAL_PIECES; i++) sourceNode.replicaStore.addPiece(contentHash, i)

sim.publishAnnouncement({
  pubkey: sourceNode.id,
  qkey: 'content-swarm-1',
  hash: contentHash,
  sizeBytes: TOTAL_PIECES * PIECE_SIZE,
  pieces: TOTAL_PIECES,
  pieceSize: PIECE_SIZE,
  ttl: 86400,
}, 0)

let totalSourceBytes = 0
let totalReplicaBytes = 0

// Each tick: nodes that got the announcement try to fetch pieces from known replicas
sim.on('tick', (round: number) => {
  for (const node of sim.nodes) {
    if (!node.online || node === sourceNode) continue
    if (node.replicaStore.isComplete(contentHash)) continue

    const providers = []
    const best = node.neighbourState.bestReplicaNeighbour('content-swarm-1')
    if (best) {
      const bestNode = sim.nodes.find(n => n.id === best)
      if (bestNode?.replicaStore.heldPieces(contentHash).size) {
        const ranges: [number, number][] = [[0, TOTAL_PIECES - 1]]
        providers.push({ nodeId: best, reputation: node.reputationMap.get(best), pieceRanges: ranges })
      }
    }
    // Always allow fetching from source as fallback
    providers.push({ nodeId: sourceNode.id, reputation: 0.5, pieceRanges: [[0, TOTAL_PIECES - 1]] })

    node.replicaStore.declareTotal(contentHash, TOTAL_PIECES)
    const tasks = selectPiecesToFetch(contentHash, TOTAL_PIECES, node.replicaStore, providers)
    const toFetch = tasks.slice(0, 4) // max 4 pieces per tick
    for (const task of toFetch) {
      node.replicaStore.addPiece(contentHash, task.pieceIndex)
      const bytes = PIECE_SIZE
      if (task.provider === sourceNode.id) {
        totalSourceBytes += bytes
        sim['metrics'].recordSourceBytes(round, bytes)
      } else {
        totalReplicaBytes += bytes
      }
      sim['metrics'].recordContentBytes(round, bytes)
      node.metrics.piecesFetched++
    }
  }
  if (round % 100 === 0) process.stdout.write(`  tick ${round}/600\r`)
})

await sim.run()
const report = sim.report(['content-swarm-1'])
printReport(report)

const completeNodes = sim.nodes.filter(n => n.replicaStore.isComplete(contentHash)).length
const totalBytes = totalSourceBytes + totalReplicaBytes
const sourcePct = totalBytes > 0 ? (totalSourceBytes / totalBytes * 100).toFixed(1) : '0'
console.log(`\n  complete replicas: ${completeNodes}/${sim.nodes.length}`)
console.log(`  source served: ${sourcePct}% of total bytes`)
console.log(`  total bytes transferred: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`)
```

- [ ] **Step 2: Run**

```bash
npm run sim:swarm
```

Expected: completes. Source bandwidth fraction should be well below 100%.

- [ ] **Step 3: Commit**

```bash
git add src/sim/scenarios/swarming.ts
git commit -m "feat(sim): swarming scenario — 200MB piece distribution across 500 nodes"
```

---

## Task 17: DHT Baseline (Kademlia)

**Files:**
- Create: `src/sim/scenarios/dht-baseline.ts`

- [ ] **Step 1: Implement dht-baseline.ts**

```ts
// src/sim/scenarios/dht-baseline.ts
import { MetricsCollector } from '../runner/metrics.js'
import { ChurnSchedule } from '../runner/churn.js'
import { buildReport, printReport } from '../runner/report.js'
import { Topology } from '../../core/graph/topology.js'
import { GraphState } from '../../core/graph/graph-state.js'

// --- Kademlia types ---
type NodeId = bigint  // 160-bit

function xorDist(a: NodeId, b: NodeId): NodeId { return a ^ b }
function randomId(seed: number): NodeId {
  // Deterministic 160-bit from seed
  let s = BigInt(seed)
  let id = 0n
  for (let i = 0; i < 5; i++) {
    s = (s * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn
    id = (id << 32n) | (s & 0xFFFFFFFFn)
  }
  return id & ((1n << 160n) - 1n)
}

interface KadNode {
  id: string
  nodeId: NodeId
  online: boolean
  buckets: Map<number, string[]>  // bucket index -> peer ids
  store: Map<string, string>      // key -> value
  inbox: unknown[]
  metrics: { sends: number; receives: number; stores: number }
}

const K = 20, ALPHA = 3
const REPUBLISH_INTERVAL = 60, BUCKET_REFRESH = 30

function bucketIndex(a: NodeId, b: NodeId): number {
  const dist = xorDist(a, b)
  if (dist === 0n) return 0
  let bit = 159
  while (bit > 0 && !((dist >> BigInt(bit)) & 1n)) bit--
  return bit
}

function closestNodes(target: NodeId, allNodes: KadNode[], k: number): KadNode[] {
  return [...allNodes]
    .filter(n => n.online)
    .sort((a, b) => {
      const da = xorDist(a.nodeId, target), db = xorDist(b.nodeId, target)
      return da < db ? -1 : da > db ? 1 : 0
    })
    .slice(0, k)
}

// --- Simulation ---
const N = 500
const TICKS = 600

const g = new GraphState()
Topology.barabasiAlbert({ n: N, m: 3, seed: 42 }).apply(g)

const nodes: KadNode[] = Array.from({ length: N }, (_, i) => ({
  id: `kad-${i}`,
  nodeId: randomId(i),
  online: true,
  buckets: new Map(),
  store: new Map(),
  inbox: [],
  metrics: { sends: 0, receives: 0, stores: 0 },
}))

const metrics = new MetricsCollector(N)
const churn = new ChurnSchedule()

// 20% churn matching the churn scenario
function makePrng(seed: number) {
  let s = seed >>> 0
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296 }
}
const rand = makePrng(7)
const churnSet = nodes.filter(() => rand() < 0.2)
for (const n of churnSet) {
  const off = Math.floor(rand() * 200) + 50
  churn.schedule(n.id, { offlineAt: off, onlineAt: off + 50 })
}

// Bootstrap: each node knows K random others
const rng = makePrng(99)
for (const node of nodes) {
  const peers = [...nodes].sort(() => rng() - 0.5).slice(0, K).filter(p => p !== node)
  for (const peer of peers) {
    const bi = bucketIndex(node.nodeId, peer.nodeId)
    const bucket = node.buckets.get(bi) ?? []
    if (!bucket.includes(peer.id)) bucket.push(peer.id)
    node.buckets.set(bi, bucket.slice(-K))
  }
}

// Publish content from node 0
const contentKey = 'content-kad-1'
const contentKeyId = randomId(12345)
const targets = closestNodes(contentKeyId, nodes, K)
for (const t of targets) {
  t.store.set(contentKey, 'data')
  t.metrics.stores++
}

const interested = new Set(nodes.slice(1, 201).map(n => n.id))
metrics.setInterestedNodes(contentKey, interested)

// Run ticks
for (let tick = 1; tick <= TICKS; tick++) {
  metrics.startTick(tick)

  // Apply churn
  for (const id of churn.goingOffline(tick)) {
    const n = nodes.find(x => x.id === id)
    if (n) n.online = false
  }
  for (const id of churn.goingOnline(tick)) {
    const n = nodes.find(x => x.id === id)
    if (n) {
      n.online = true
      // Re-bootstrap: announce to K closest
      const closest = closestNodes(n.nodeId, nodes, K)
      for (const peer of closest) {
        peer.inbox.push({ type: 'FIND_NODE', from: n.id, target: n.nodeId })
        metrics.recordAnnouncementSent(tick)
        n.metrics.sends++
      }
    }
  }

  // Process messages
  for (const node of nodes) {
    if (!node.online) continue
    const msgs = node.inbox.splice(0)
    for (const m of msgs) {
      const msg = m as Record<string, unknown>
      node.metrics.receives++
      if (msg['type'] === 'FIND_VALUE' && node.store.has(contentKey)) {
        metrics.recordDelivered(contentKey, msg['from'] as string)
      }
    }
  }

  // Republish every 60 ticks
  if (tick % REPUBLISH_INTERVAL === 0) {
    const newTargets = closestNodes(contentKeyId, nodes, K)
    for (const t of newTargets) {
      t.store.set(contentKey, 'data')
      metrics.recordAnnouncementSent(tick)
    }
  }

  // Bucket refresh every 30 ticks
  if (tick % BUCKET_REFRESH === 0) {
    for (const node of nodes) {
      if (!node.online) continue
      const closest = closestNodes(node.nodeId, nodes, ALPHA)
      for (const peer of closest) {
        peer.inbox.push({ type: 'FIND_NODE', from: node.id, target: node.nodeId })
        metrics.recordAnnouncementSent(tick)
        node.metrics.sends++
      }
    }
  }

  // Interested nodes try FIND_VALUE
  for (const node of nodes) {
    if (!node.online) continue
    if (!interested.has(node.id)) continue
    if (node.store.has(contentKey)) { metrics.recordDelivered(contentKey, node.id); continue }
    const closest = closestNodes(contentKeyId, nodes, ALPHA)
    for (const peer of closest) {
      peer.inbox.push({ type: 'FIND_VALUE', from: node.id, key: contentKey })
      metrics.recordAnnouncementSent(tick)
      node.metrics.sends++
    }
  }

  metrics.endTick(tick)
  if (tick % 100 === 0) process.stdout.write(`  tick ${tick}/${TICKS}\r`)
}

const report = buildReport('Kademlia', N, TICKS, metrics, [contentKey])
printReport(report)
console.log(`\n  churned nodes: ${churnSet.length}`)
```

- [ ] **Step 2: Run**

```bash
npm run sim:dht-baseline
```

Expected: completes, prints Kademlia metrics in the same format as qDHT scenarios.

- [ ] **Step 3: Commit**

```bash
git add src/sim/scenarios/dht-baseline.ts
git commit -m "feat(sim): Kademlia DHT baseline scenario for comparison"
```

---

## Task 18: Full Test Suite & Final Verification

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all tests pass, no failures.

- [ ] **Step 2: Run all scenarios**

```bash
npm run sim:stable && npm run sim:churn && npm run sim:spam && npm run sim:swarm && npm run sim:dht-baseline
```

Expected: all five complete without errors, each printing a metrics report.

- [ ] **Step 3: TypeScript strict check**

```bash
npm run build
```

Expected: exits 0, no type errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete qDHT simulation library (Phase 1)"
```
