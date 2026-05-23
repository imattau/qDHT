import { describe, expect, it, vi } from 'vitest'
import { generateKeypair } from '../identity/keys.js'
import { buildAnnouncement } from '../protocol/announcement.js'
import { LiveNodeAdapter } from './relay-adapter.js'
import { type NostrEvent } from './event.js'

describe('LiveNodeAdapter', () => {
  it('signs and publishes outbound announcements', async () => {
    const keypair = generateKeypair()
    const publish = vi.fn()
    const adapter = new LiveNodeAdapter(
      { publish },
      { privkeyHex: keypair.privkey },
    )

    const announcement = buildAnnouncement({
      pubkey: keypair.pubkey,
      qkey: 'k1',
      hash: 'h1',
      sizeBytes: 1,
      pieces: 1,
      pieceSize: 1,
      ttl: 60,
    })

    const signed = await adapter.publishAnnouncement(announcement)

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(signed)
    expect(signed.id).toMatch(/^[0-9a-f]{64}$/)
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/)
  })

  it('accepts inbound events that match configured filters', () => {
    const adapter = new LiveNodeAdapter(
      { publish: vi.fn() },
      {
        privkeyHex: generateKeypair().privkey,
        publishFilters: [{ kinds: [10800], '#qkey': ['alpha'] }],
      },
    )

    const event = {
      kind: 10800,
      pubkey: 'a'.repeat(64),
      created_at: 1,
      tags: [['qkey', 'alpha']],
      content: '',
      sig: '',
    } satisfies NostrEvent

    expect(adapter.accepts(event)).toBe(true)
  })

  it('rejects inbound events that fail configured filters', () => {
    const adapter = new LiveNodeAdapter(
      { publish: vi.fn() },
      {
        privkeyHex: generateKeypair().privkey,
        publishFilters: [{ kinds: [10800], '#qkey': ['alpha'] }],
      },
    )

    const event = {
      kind: 10800,
      pubkey: 'a'.repeat(64),
      created_at: 1,
      tags: [['qkey', 'beta']],
      content: '',
      sig: '',
    } satisfies NostrEvent

    expect(adapter.accepts(event)).toBe(false)
  })
})
