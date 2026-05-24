import { describe, expect, it } from 'vitest'
import { runBenchmark } from './dht-benchmark.js'

describe('dht benchmark', () => {
  it('runs a small qDHT vs Kad-DHT comparison', async () => {
    const result = await runBenchmark({
      nodes: 2,
      rounds: 1,
      timeoutMs: 8_000,
      payloadBytes: 8 * 1024,
      qdhtPortBase: 24600,
    })

    expect(result.qdht.nodes).toBe(2)
    expect(result.kadDht.nodes).toBe(2)
    expect(result.qdht.rounds).toBe(1)
    expect(result.kadDht.rounds).toBe(1)
    expect(result.qdht.coverageAvg).toBeGreaterThanOrEqual(0)
    expect(result.kadDht.coverageAvg).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(result.qdht.publishMsAvg)).toBe(true)
    expect(Number.isFinite(result.kadDht.publishMsAvg)).toBe(true)
  }, 120_000)
})
