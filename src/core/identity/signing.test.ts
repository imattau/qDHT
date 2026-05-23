import { describe, expect, it } from 'vitest'
import { generateKeypair } from './keys.js'
import { eventId, signAnnouncement, signEvent, verifyEvent } from './signing.js'
import { isSignedEvent, type NostrEvent } from '../nostr/event.js'
import { buildAnnouncement } from '../protocol/announcement.js'

function makeUnsigned(pubkey: string): NostrEvent {
  return {
    kind: 1,
    pubkey,
    created_at: 1700000000,
    tags: [],
    content: 'hello',
    sig: '',
  }
}

describe('eventId', () => {
  it('returns a 64-char lowercase hex string', () => {
    const keypair = generateKeypair()
    const id = eventId(makeUnsigned(keypair.pubkey))
    expect(id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same event', () => {
    const keypair = generateKeypair()
    const event = makeUnsigned(keypair.pubkey)
    expect(eventId(event)).toBe(eventId(event))
  })
})

describe('signEvent', () => {
  it('produces a SignedNostrEvent with valid id and sig', () => {
    const keypair = generateKeypair()
    const signed = signEvent(makeUnsigned(keypair.pubkey), keypair.privkey)
    expect(isSignedEvent(signed)).toBe(true)
    expect(signed.id).toMatch(/^[0-9a-f]{64}$/)
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/)
  })

  it('throws for invalid privkey', () => {
    const keypair = generateKeypair()
    expect(() => signEvent(makeUnsigned(keypair.pubkey), 'tooshort')).toThrow()
  })
})

describe('verifyEvent', () => {
  it('returns true for a correctly signed event', () => {
    const keypair = generateKeypair()
    const signed = signEvent(makeUnsigned(keypair.pubkey), keypair.privkey)
    expect(verifyEvent(signed)).toBe(true)
  })

  it('returns false for a tampered event', () => {
    const keypair = generateKeypair()
    const signed = signEvent(makeUnsigned(keypair.pubkey), keypair.privkey)
    const tampered = { ...signed, content: 'tampered' }
    expect(verifyEvent(tampered as typeof signed)).toBe(false)
  })
})

describe('signAnnouncement', () => {
  it('produces a SignedNostrEvent with kind 10800', () => {
    const keypair = generateKeypair()
    const announcement = buildAnnouncement({
      pubkey: keypair.pubkey,
      qkey: 'mykey',
      hash: 'deadbeef',
      sizeBytes: 1024,
      pieces: 4,
      pieceSize: 256,
      ttl: 3600,
    })
    const signed = signAnnouncement(announcement, keypair.privkey)
    expect(signed.kind).toBe(10800)
    expect(isSignedEvent(signed)).toBe(true)
    expect(verifyEvent(signed)).toBe(true)
  })
})
