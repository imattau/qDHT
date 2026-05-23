import { describe, expect, it } from 'vitest'
import { type NostrEvent } from './event.js'
import { matchesFilter, type NostrFilter } from './filter.js'

const event: NostrEvent & { id: string } = {
  id: 'abcd1234' + '0'.repeat(56),
  kind: 10800,
  pubkey: 'pub1' + '0'.repeat(60),
  created_at: 1000000,
  tags: [
    ['qkey', 'mykey'],
    ['hash', 'deadbeef'],
  ],
  content: '',
  sig: 'f'.repeat(128),
}

describe('matchesFilter', () => {
  it('empty filter matches any event', () => {
    expect(matchesFilter(event, {})).toBe(true)
  })

  it('ids: prefix match passes', () => {
    expect(matchesFilter(event, { ids: ['abcd1234'] })).toBe(true)
  })

  it('ids: prefix match fails for wrong prefix', () => {
    expect(matchesFilter(event, { ids: ['deadbeef'] })).toBe(false)
  })

  it('ids: unsigned event (no id) fails when ids filter set', () => {
    const unsigned = { ...event, id: undefined } as unknown as NostrEvent
    expect(matchesFilter(unsigned, { ids: ['abcd1234'] })).toBe(false)
  })

  it('authors: prefix match passes', () => {
    expect(matchesFilter(event, { authors: ['pub1'] })).toBe(true)
  })

  it('authors: prefix match fails', () => {
    expect(matchesFilter(event, { authors: ['aaaa'] })).toBe(false)
  })

  it('kinds: matches when kind is in list', () => {
    expect(matchesFilter(event, { kinds: [10800, 10801] })).toBe(true)
  })

  it('kinds: fails when kind not in list', () => {
    expect(matchesFilter(event, { kinds: [10801] })).toBe(false)
  })

  it('since: inclusive lower bound passes', () => {
    expect(matchesFilter(event, { since: 1000000 })).toBe(true)
  })

  it('since: event before lower bound fails', () => {
    expect(matchesFilter(event, { since: 1000001 })).toBe(false)
  })

  it('until: inclusive upper bound passes', () => {
    expect(matchesFilter(event, { until: 1000000 })).toBe(true)
  })

  it('until: event after upper bound fails', () => {
    expect(matchesFilter(event, { until: 999999 })).toBe(false)
  })

  it('#qkey tag filter passes when value matches', () => {
    expect(matchesFilter(event, { '#qkey': ['mykey'] } as NostrFilter)).toBe(true)
  })

  it('#qkey tag filter fails when value does not match', () => {
    expect(matchesFilter(event, { '#qkey': ['otherkey'] } as NostrFilter)).toBe(false)
  })

  it('#hash tag filter passes with one of multiple values', () => {
    expect(matchesFilter(event, { '#hash': ['deadbeef', 'cafebabe'] } as NostrFilter)).toBe(true)
  })

  it('combined filter: all conditions must pass', () => {
    expect(matchesFilter(event, {
      kinds: [10800],
      since: 999999,
      until: 1000001,
      '#qkey': ['mykey'],
    } as NostrFilter)).toBe(true)
  })

  it('combined filter: one failing condition fails the whole filter', () => {
    expect(matchesFilter(event, {
      kinds: [10800],
      '#qkey': ['wrongkey'],
    } as NostrFilter)).toBe(false)
  })
})
