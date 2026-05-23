import { describe, expect, it } from 'vitest'
import { isSignedEvent, type NostrEvent, type SignedNostrEvent } from './event.js'

describe('isSignedEvent', () => {
  const base: NostrEvent = {
    kind: 10800,
    pubkey: 'a'.repeat(64),
    created_at: 1000000,
    tags: [],
    content: '',
    sig: '',
  }

  it('returns false for unsigned event (no id, empty sig)', () => {
    expect(isSignedEvent(base)).toBe(false)
  })

  it('returns false when id is wrong length', () => {
    const event = { ...base, id: 'abc', sig: 'f'.repeat(128) }
    expect(isSignedEvent(event as NostrEvent)).toBe(false)
  })

  it('returns false when sig is wrong length', () => {
    const event = { ...base, id: 'a'.repeat(64), sig: 'tooshort' }
    expect(isSignedEvent(event as NostrEvent)).toBe(false)
  })

  it('returns true for event with valid id and sig lengths', () => {
    const signed: SignedNostrEvent = {
      ...base,
      id: 'a'.repeat(64),
      sig: 'b'.repeat(128),
    }
    expect(isSignedEvent(signed)).toBe(true)
  })
})
