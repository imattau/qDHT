import { describe, expect, it } from 'vitest'
import { ReputationMap, reputationFactor } from './reputation.js'

describe('reputationFactor', () => {
  it('returns 1 for non-negative reputation', () => {
    expect(reputationFactor(0, 0.5, 10)).toBe(1)
    expect(reputationFactor(0.5, 0.5, 10)).toBe(1)
  })

  it('returns exp(-2*gamma*|rep|*t) for negative reputation', () => {
    const rep = -0.5
    const gamma = 0.5
    const t = 10
    const expected = Math.exp(-2 * gamma * Math.abs(rep) * t)
    expect(reputationFactor(rep, gamma, t)).toBeCloseTo(expected)
  })

  it('decays to near-zero for very negative rep over time', () => {
    expect(reputationFactor(-1, 0.5, 100)).toBeLessThan(0.001)
  })
})

describe('ReputationMap', () => {
  it('defaults to 0 for unknown nodes', () => {
    const map = new ReputationMap()
    expect(map.get('unknown')).toBe(0)
  })

  it('clamps scores to [-1, 1]', () => {
    const map = new ReputationMap()
    map.set('a', 2)
    expect(map.get('a')).toBe(1)
    map.set('a', -2)
    expect(map.get('a')).toBe(-1)
  })

  it('merges neighbour state with weighted average', () => {
    const map = new ReputationMap()
    map.set('a', 0.8)
    map.merge('a', 0.2, 0.5)
    expect(map.get('a')).toBeCloseTo((0.8 + 0.1) / 1.5, 5)
  })
})
