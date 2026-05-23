import { describe, expect, it } from 'vitest'
import { getTag, getTags, hasTag, buildTagMap } from './tags.js'

const tags: string[][] = [
  ['qkey', 'abc123'],
  ['hash', 'deadbeef'],
  ['hash', 'cafebabe'],
  ['size', '1024'],
]

describe('getTag', () => {
  it('returns first value of first matching tag', () => {
    expect(getTag(tags, 'qkey')).toBe('abc123')
  })

  it('returns first value when multiple tags share a name', () => {
    expect(getTag(tags, 'hash')).toBe('deadbeef')
  })

  it('returns undefined for absent tag', () => {
    expect(getTag(tags, 'missing')).toBeUndefined()
  })
})

describe('getTags', () => {
  it('returns all entries matching name', () => {
    expect(getTags(tags, 'hash')).toEqual([
      ['hash', 'deadbeef'],
      ['hash', 'cafebabe'],
    ])
  })

  it('returns empty array for absent tag', () => {
    expect(getTags(tags, 'missing')).toEqual([])
  })
})

describe('hasTag', () => {
  it('returns true for present tag', () => {
    expect(hasTag(tags, 'size')).toBe(true)
  })

  it('returns false for absent tag', () => {
    expect(hasTag(tags, 'missing')).toBe(false)
  })
})

describe('buildTagMap', () => {
  it('maps each name to its first value', () => {
    const map = buildTagMap(tags)
    expect(map.get('qkey')).toBe('abc123')
    expect(map.get('hash')).toBe('deadbeef')
    expect(map.get('size')).toBe('1024')
  })

  it('returns empty map for no tags', () => {
    expect(buildTagMap([])).toEqual(new Map())
  })
})
