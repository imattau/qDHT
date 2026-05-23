import { describe, expect, it } from 'vitest'
import { buildAnnouncement, isValidAnnouncement } from './announcement.js'
import { buildDeltaRequest, buildDeltaResponse } from './delta.js'
import { buildPieceManifest } from './piece-manifest.js'
import { buildReplicaRecord } from './replica-record.js'

describe('announcement', () => {
  it('round-trips through JSON', () => {
    const announcement = buildAnnouncement({
      pubkey: 'pk1',
      qkey: 'key1',
      hash: 'abc',
      sizeBytes: 1024,
      pieces: 4,
      pieceSize: 256,
      ttl: 3600,
    })
    const parsed = JSON.parse(JSON.stringify(announcement))
    expect(isValidAnnouncement(parsed)).toBe(true)
    expect(parsed.kind).toBe(10800)
  })

  it('includes url and r tags when provided', () => {
    const announcement = buildAnnouncement({
      pubkey: 'pk1',
      qkey: 'key1',
      hash: 'abc',
      sizeBytes: 1024,
      pieces: 4,
      pieceSize: 256,
      ttl: 3600,
      url: 'https://example.com/file',
    })
    expect(announcement.tags).toEqual(expect.arrayContaining([
      ['url', 'https://example.com/file'],
      ['r', 'https://example.com/file'],
    ]))
  })

  it('rejects invalid announcement', () => {
    expect(isValidAnnouncement({ kind: 999 })).toBe(false)
    expect(isValidAnnouncement(null)).toBe(false)
  })
})

describe('replicaRecord', () => {
  it('has correct kind', () => {
    const record = buildReplicaRecord({
      pubkey: 'pk1',
      qkey: 'key1',
      hash: 'abc',
      provider: 'pk2',
      complete: true,
      ttl: 3600,
    })
    expect(record.kind).toBe(10801)
    expect(JSON.parse(JSON.stringify(record)).kind).toBe(10801)
  })
})

describe('delta', () => {
  it('request has correct kind and since tag', () => {
    const request = buildDeltaRequest({ pubkey: 'pk1', since: 42, limit: 100 })
    expect(request.kind).toBe(20800)
    expect(request.tags.find((tag) => tag[0] === 'since')?.[1]).toBe('42')
  })

  it('response has correct kind', () => {
    const response = buildDeltaResponse({
      pubkey: 'pk1',
      requestId: 'req1',
      since: 42,
      announcements: ['a1', 'a2'],
      replicas: [],
      reputationDeltas: [],
      expired: [],
    })
    expect(response.kind).toBe(20801)
  })
})

describe('pieceManifest', () => {
  it('has correct kind and piece count', () => {
    const manifest = buildPieceManifest({
      pubkey: 'pk1',
      qkey: 'k1',
      hash: 'h1',
      sizeBytes: 512,
      pieceSize: 256,
      pieces: [
        { index: 0, hash: 'ph0' },
        { index: 1, hash: 'ph1' },
      ],
    })
    expect(manifest.kind).toBe(10803)
    expect(manifest.pieces).toHaveLength(2)
  })
})
