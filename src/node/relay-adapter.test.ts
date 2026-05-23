import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeypair } from '../core/identity/keys.js'
import { buildAnnouncement } from '../core/protocol/announcement.js'
import { signAnnouncement } from '../core/identity/signing.js'
import { RelayAdapter } from './relay-adapter.js'

const mocks = vi.hoisted(() => ({
  subscribeMany: vi.fn(),
  publish: vi.fn(),
  poolClose: vi.fn(),
  subscriptionClose: vi.fn(),
}))

const { subscribeMany, publish, poolClose, subscriptionClose } = mocks

let subscribedParams: { onevent?: (event: unknown) => void } | null = null

vi.mock('nostr-tools/pool', () => ({
  SimplePool: vi.fn().mockImplementation(() => ({
    subscribeMany,
    publish,
    close: poolClose,
  })),
}))

describe('RelayAdapter', () => {
  beforeEach(() => {
    subscribeMany.mockReset()
    publish.mockReset()
    poolClose.mockReset()
    subscriptionClose.mockReset()
    subscribedParams = null
    subscribeMany.mockImplementation(
      (_relays: string[], _filter: unknown, params: { onevent?: (event: unknown) => void }) => {
      subscribedParams = params
      return { close: subscriptionClose }
      },
    )
    publish.mockReturnValue([Promise.resolve('ok')])
  })

  it('subscribes with the default qDHT filter and forwards inbound events', async () => {
    const adapter = new RelayAdapter({
      privkey: 'a'.repeat(64),
      relayUrls: ['wss://relay.one', 'wss://relay.two'],
    })
    const received: Array<{ msg: unknown; peerId: string }> = []
    adapter.onMessage((msg, peerId) => {
      received.push({ msg, peerId })
    })

    await adapter.connect()

    expect(subscribeMany).toHaveBeenCalledTimes(1)
    expect(subscribeMany).toHaveBeenCalledWith(
      ['wss://relay.one', 'wss://relay.two'],
      { kinds: [10800, 10801, 10802, 10803, 20800, 20801] },
      expect.objectContaining({ onevent: expect.any(Function) }),
    )

    const keypair = generateKeypair()
    const event = signAnnouncement(
      buildAnnouncement({
        pubkey: keypair.pubkey,
        qkey: 'qk-1',
        hash: 'h'.repeat(64),
        sizeBytes: 1,
        pieces: 1,
        pieceSize: 1,
        ttl: 60,
      }),
      keypair.privkey,
    )

    subscribedParams?.onevent?.(event)
    expect(received).toEqual([{ msg: event, peerId: event.pubkey }])
  })

  it('publishes signed events to all relays and ignores excludePeerId', () => {
    const adapter = new RelayAdapter({
      privkey: 'b'.repeat(64),
      relayUrls: ['wss://relay.one', 'wss://relay.two'],
    })
    const keypair = generateKeypair()
    const event = signAnnouncement(
      buildAnnouncement({
        pubkey: keypair.pubkey,
        qkey: 'qk-2',
        hash: 'd'.repeat(64),
        sizeBytes: 1,
        pieces: 1,
        pieceSize: 1,
        ttl: 60,
      }),
      keypair.privkey,
    )

    adapter.broadcast(event, 'ignored-peer')
    adapter.send('peer-x', event)

    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenNthCalledWith(1, ['wss://relay.one', 'wss://relay.two'], event)
    expect(publish).toHaveBeenNthCalledWith(2, ['wss://relay.one', 'wss://relay.two'], event)
  })

  it('skips publishing when the event is not signed', () => {
    const adapter = new RelayAdapter({
      privkey: 'c'.repeat(64),
      relayUrls: ['wss://relay.one'],
    })

    adapter.broadcast({ kind: 10800, pubkey: 'a', created_at: 1, tags: [], content: '', sig: '' })

    expect(publish).not.toHaveBeenCalled()
  })

  it('closes subscription and relay connections', async () => {
    const adapter = new RelayAdapter({
      privkey: 'd'.repeat(64),
      relayUrls: ['wss://relay.one', 'wss://relay.two'],
    })

    await adapter.connect()
    await adapter.close()

    expect(subscriptionClose).toHaveBeenCalledTimes(1)
    expect(poolClose).toHaveBeenCalledWith(['wss://relay.one', 'wss://relay.two'])
  })
})
