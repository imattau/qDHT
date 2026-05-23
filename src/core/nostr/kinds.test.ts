import { describe, expect, it } from 'vitest'
import { QDHT_KIND, NOSTR_KIND_ROWS, QDHT_KIND_ROWS, isQDHTKind } from './kinds.js'

describe('QDHT_KIND', () => {
  it('has the expected numeric values', () => {
    expect(QDHT_KIND.ANNOUNCEMENT).toBe(10800)
    expect(QDHT_KIND.REPLICA_RECORD).toBe(10801)
    expect(QDHT_KIND.REPUTATION_DELTA).toBe(10802)
    expect(QDHT_KIND.PIECE_MANIFEST).toBe(10803)
    expect(QDHT_KIND.REQUEST_ANNOUNCEMENT).toBe(10804)
    expect(QDHT_KIND.REQUEST_RESPONSE).toBe(10805)
    expect(QDHT_KIND.DELTA_REQUEST).toBe(20800)
    expect(QDHT_KIND.DELTA_RESPONSE).toBe(20801)
  })
})

describe('isQDHTKind', () => {
  it('accepts all valid kinds', () => {
    expect(isQDHTKind(10800)).toBe(true)
    expect(isQDHTKind(10801)).toBe(true)
    expect(isQDHTKind(10802)).toBe(true)
    expect(isQDHTKind(10803)).toBe(true)
    expect(isQDHTKind(10804)).toBe(true)
    expect(isQDHTKind(10805)).toBe(true)
    expect(isQDHTKind(20800)).toBe(true)
    expect(isQDHTKind(20801)).toBe(true)
  })

  it('rejects unknown kinds', () => {
    expect(isQDHTKind(0)).toBe(false)
    expect(isQDHTKind(1)).toBe(false)
    expect(isQDHTKind(10799)).toBe(false)
    expect(isQDHTKind(99999)).toBe(false)
  })
})

describe('QDHT_KIND_ROWS', () => {
  it('includes metadata for each known kind', () => {
    expect(QDHT_KIND_ROWS).toHaveLength(8)
    expect(QDHT_KIND_ROWS.find((row) => row.kind_id === QDHT_KIND.ANNOUNCEMENT)).toMatchObject({
      name: 'announcement',
      category: 'content',
      searchable: 1,
    })
    expect(QDHT_KIND_ROWS.find((row) => row.kind_id === QDHT_KIND.REQUEST_ANNOUNCEMENT)).toMatchObject({
      name: 'request_announcement',
      category: 'request',
      searchable: 1,
    })
  })
})

describe('NOSTR_KIND_ROWS', () => {
  it('includes routing kinds used by the live node', () => {
    expect(NOSTR_KIND_ROWS).toHaveLength(10)
    expect(NOSTR_KIND_ROWS.find((row) => row.kind_id === 30800)).toMatchObject({
      name: 'observed_address',
      category: 'routing',
      searchable: 1,
    })
    expect(NOSTR_KIND_ROWS.find((row) => row.kind_id === 30801)).toMatchObject({
      name: 'route_announcement',
      category: 'routing',
      searchable: 1,
    })
  })
})
