import { GraphState } from './graph-state.js'

function makePrng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 4294967296
  }
}

export interface TopologyConfig {
  apply(graph: GraphState): void
}

export const Topology = {
  erdosRenyi({
    n,
    p,
    seed = 0,
  }: {
    n: number
    p: number
    seed?: number
  }): TopologyConfig {
    return {
      apply(graph: GraphState) {
        const ids = Array.from({ length: n }, (_, index) => `node-${index}`)
        graph.setNodes(ids)
        const rand = makePrng(seed)

        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            if (rand() < p) {
              graph.setConnection(ids[i]!, ids[j]!, true)
            }
          }
        }
      },
    }
  },

  barabasiAlbert({
    n,
    m,
    seed = 0,
  }: {
    n: number
    m: number
    seed?: number
  }): TopologyConfig {
    return {
      apply(graph: GraphState) {
        const ids = Array.from({ length: n }, (_, index) => `node-${index}`)
        graph.setNodes(ids)
        const rand = makePrng(seed)
        const degrees = Array.from({ length: n }, () => 0)

        const seedSize = Math.min(n, Math.max(2, m + 1))
        for (let i = 0; i < seedSize; i++) {
          for (let j = i + 1; j < seedSize; j++) {
            graph.setConnection(ids[i]!, ids[j]!, true)
            degrees[i]! += 1
            degrees[j]! += 1
          }
        }

        for (let i = seedSize; i < n; i++) {
          const targetCount = Math.min(m, i)
          const targets = new Set<number>()

          while (targets.size < targetCount) {
            let totalDegree = 0
            for (let j = 0; j < i; j++) {
              totalDegree += Math.max(1, degrees[j] ?? 0)
            }
            let cursor = rand() * totalDegree
            for (let j = 0; j < i; j++) {
              cursor -= Math.max(1, degrees[j] ?? 0)
              if (cursor <= 0) {
                targets.add(j)
                break
              }
            }
          }

          for (const target of targets) {
            graph.setConnection(ids[i]!, ids[target]!, true)
            degrees[i]! += 1
            degrees[target]! += 1
          }
        }
      },
    }
  },

  fromAdjacency(nodeIds: string[], edges: [number, number][]): TopologyConfig {
    return {
      apply(graph: GraphState) {
        graph.setNodes(nodeIds)
        for (const [a, b] of edges) {
          const left = nodeIds[a]
          const right = nodeIds[b]
          if (left && right) {
            graph.setConnection(left, right, true)
          }
        }
      },
    }
  },
}
