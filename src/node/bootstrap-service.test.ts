import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BootstrapService } from './bootstrap-service.js'
import { generateKeypair } from '../core/identity/keys.js'
import { signEvent } from '../core/identity/signing.js'
import { QDHT_KIND } from '../core/nostr/kinds.js'
import type { SignedNostrEvent } from '../core/nostr/event.js'

function makeServiceRecord(pubkey: string, privkey: string, url: string, createdAt?: number): SignedNostrEvent {
  return signEvent(
    {
      kind: QDHT_KIND.SERVICE_RECORD,
      pubkey,
      created_at: createdAt ?? Math.floor(Date.now() / 1000),
      tags: [['transport', 'ws'], ['d', 'main'], ['url', url]],
      content: '',
      sig: '',
    },
    privkey,
  )
}

describe('BootstrapService', () => {
  let svc: BootstrapService
  let nodeKp: { pubkey: string; privkey: string }

  beforeEach(() => {
    nodeKp = generateKeypair()
    svc = new BootstrapService({ pubkey: nodeKp.pubkey, privkey: nodeKp.privkey, maxPeers: 10 })
  })

  afterEach(() => {
    svc.stop()
  })

  it('caches a valid 30181 event', () => {
    const peer = generateKeypair()
    const event = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:7777')
    const sent: unknown[] = []
    svc.handleEvent(event, peer.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(1)
  })

  it('discards an event with invalid signature', () => {
    const peer = generateKeypair()
    const event = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:7777')
    // Tamper with sig
    const tampered = { ...event, sig: 'f'.repeat(128) }
    const sent: unknown[] = []
    svc.handleEvent(tampered, peer.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(0)
  })

  it('discards own pubkey event', () => {
    const event = makeServiceRecord(nodeKp.pubkey, nodeKp.privkey, 'ws://self:7777')
    const sent: unknown[] = []
    svc.handleEvent(event, nodeKp.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(0)
  })

  it('discards a stale replacement (older created_at)', () => {
    const peer = generateKeypair()
    const now = Math.floor(Date.now() / 1000)
    const newer = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:7777', now)
    const older = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:old', now - 60)
    const sent: unknown[] = []
    svc.handleEvent(newer, peer.pubkey, (msg) => sent.push(msg))
    svc.handleEvent(older, peer.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(1)
    // The cached URL should still be the newer one
  })

  it('accepts a strict replacement (newer created_at)', () => {
    const peer = generateKeypair()
    const now = Math.floor(Date.now() / 1000)
    const older = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:old', now - 60)
    const newer = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:new', now)
    const sent: unknown[] = []
    svc.handleEvent(older, peer.pubkey, (msg) => sent.push(msg))
    svc.handleEvent(newer, peer.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(1)
  })

  it('discards expired event on receipt', () => {
    const peer = generateKeypair()
    const now = Math.floor(Date.now() / 1000)
    // Manually add an expiration tag — re-sign so the event is valid
    const expired = signEvent(
      {
        kind: QDHT_KIND.SERVICE_RECORD,
        pubkey: peer.pubkey,
        created_at: now - 200,
        tags: [['transport', 'ws'], ['d', 'main'], ['url', 'ws://peer:7777'], ['expiration', '100']],
        content: '',
        sig: '',
      },
      peer.privkey,
    )
    const sent: unknown[] = []
    svc.handleEvent(expired, peer.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(0)
  })

  it('removes peer cache entry on disconnect', () => {
    const peer = generateKeypair()
    const event = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:7777')
    const sent: unknown[] = []
    svc.handleEvent(event, peer.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(1)
    svc.onPeerDisconnected(peer.pubkey)
    expect(svc.cacheSize()).toBe(0)
  })

  it('sends cached entries to a newly connected peer', () => {
    const peer1 = generateKeypair()
    const peer2 = generateKeypair()
    const e1 = makeServiceRecord(peer1.pubkey, peer1.privkey, 'ws://peer1:7777')
    const sent1: unknown[] = []
    svc.handleEvent(e1, peer1.pubkey, (msg) => sent1.push(msg))

    // Now peer2 connects
    const sentToPeer2: unknown[] = []
    svc.onPeerConnected(peer2.pubkey, 'ws://127.0.0.1:9999', (msg) => sentToPeer2.push(msg))

    // peer2 should have received peer1's record
    const serviceRecords = (sentToPeer2 as Array<Record<string, unknown>>).filter(
      (m) => m.kind === QDHT_KIND.SERVICE_RECORD,
    )
    expect(serviceRecords.length).toBe(1)
    expect(serviceRecords[0]!.pubkey).toBe(peer1.pubkey)
  })

  it('sends observed_address (kind 30800) to newly connected peer', () => {
    const peer = generateKeypair()
    const sentToPeer: unknown[] = []
    svc.onPeerConnected(peer.pubkey, 'ws://203.0.113.5:54321', (msg) => sentToPeer.push(msg))

    const reflection = (sentToPeer as Array<Record<string, unknown>>).find(
      (m) => m.kind === 30800,
    )
    expect(reflection).toBeDefined()
    expect((reflection as Record<string, unknown>).content).toBe('203.0.113.5')
  })

  it('evicts oldest entry when cache is full', () => {
    svc = new BootstrapService({ pubkey: nodeKp.pubkey, privkey: nodeKp.privkey, maxPeers: 2 })
    const kp1 = generateKeypair()
    const kp2 = generateKeypair()
    const kp3 = generateKeypair()
    const now = Math.floor(Date.now() / 1000)
    const e1 = makeServiceRecord(kp1.pubkey, kp1.privkey, 'ws://p1:7777', now - 20)
    const e2 = makeServiceRecord(kp2.pubkey, kp2.privkey, 'ws://p2:7777', now - 10)
    const e3 = makeServiceRecord(kp3.pubkey, kp3.privkey, 'ws://p3:7777', now)
    svc.handleEvent(e1, kp1.pubkey, () => {})
    svc.handleEvent(e2, kp2.pubkey, () => {})
    svc.handleEvent(e3, kp3.pubkey, () => {})
    // kp1 was oldest; should have been evicted
    expect(svc.cacheSize()).toBe(2)
    expect(svc.hasCached(kp1.pubkey)).toBe(false)
    expect(svc.hasCached(kp2.pubkey)).toBe(true)
    expect(svc.hasCached(kp3.pubkey)).toBe(true)
  })

  it('responds to DELTA_REQUEST with DELTA_RESPONSE containing cached event IDs', () => {
    const peer = generateKeypair()
    const event = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:7777')
    svc.handleEvent(event, peer.pubkey, () => {})

    const requester = generateKeypair()
    const deltaRequest = signEvent(
      {
        kind: QDHT_KIND.DELTA_REQUEST,
        pubkey: requester.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify({ since: 0 }),
        sig: '',
      },
      requester.privkey,
    )

    const replies: unknown[] = []
    svc.handleEvent(deltaRequest, requester.pubkey, () => {}, (msg) => replies.push(msg))

    expect(replies.length).toBe(1)
    const response = replies[0] as Record<string, unknown>
    expect(response.kind).toBe(QDHT_KIND.DELTA_RESPONSE)
    const content = JSON.parse(response.content as string) as { eventIds: string[] }
    expect(content.eventIds).toContain(event.id)
  })
})
