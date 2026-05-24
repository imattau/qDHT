import { describe, expect, it, beforeEach } from 'vitest'
import { DefaultPeerDiscoveryPolicy, REPUTATION_CONNECT_THRESHOLD } from './peer-discovery-policy.js'
import { ReputationMap } from '../core/protocol/reputation.js'
import type { PeerInfo } from './peer-manager.js'

function makePeer(url: string, pubkey = 'a'.repeat(64)): PeerInfo {
  return {
    pubkey,
    url,
    latencyMs: null,
    connectedAt: new Date().toISOString(),
  }
}

describe('DefaultPeerDiscoveryPolicy', () => {
  let policy: DefaultPeerDiscoveryPolicy
  let reputationMap: ReputationMap

  beforeEach(() => {
    policy = new DefaultPeerDiscoveryPolicy()
    reputationMap = new ReputationMap()
  })

  it('allows a new peer when all gates pass', () => {
    expect(policy.shouldConnect(
      { url: 'ws://peer.example:7777', advertiserPubkey: 'b'.repeat(64) },
      [],
      reputationMap,
      50,
    )).toBe(true)
  })

  it('rejects when max peers has been reached', () => {
    const peers = Array.from({ length: 50 }, (_, index) => makePeer(`ws://peer-${index}.example:7777`))
    expect(policy.shouldConnect(
      { url: 'ws://new.example:7777', advertiserPubkey: 'b'.repeat(64) },
      peers,
      reputationMap,
      50,
    )).toBe(false)
  })

  it('rejects when the URL is already connected after normalization', () => {
    const peers = [makePeer('ws://peer.example:7777/')]
    expect(policy.shouldConnect(
      { url: 'ws://peer.example:7777', advertiserPubkey: 'b'.repeat(64) },
      peers,
      reputationMap,
      50,
    )).toBe(false)
  })

  it('rejects when the advertiser reputation is below threshold', () => {
    reputationMap.set('b'.repeat(64), REPUTATION_CONNECT_THRESHOLD - 0.01)
    expect(policy.shouldConnect(
      { url: 'ws://peer.example:7777', advertiserPubkey: 'b'.repeat(64) },
      [],
      reputationMap,
      50,
    )).toBe(false)
  })

  it('accepts reputation at the threshold', () => {
    reputationMap.set('b'.repeat(64), REPUTATION_CONNECT_THRESHOLD)
    expect(policy.shouldConnect(
      { url: 'ws://peer.example:7777', advertiserPubkey: 'b'.repeat(64) },
      [],
      reputationMap,
      50,
    )).toBe(true)
  })

  it('accepts unknown advertisers as neutral reputation', () => {
    expect(policy.shouldConnect(
      { url: 'ws://peer.example:7777', advertiserPubkey: 'unknown'.padEnd(64, '0') },
      [],
      reputationMap,
      50,
    )).toBe(true)
  })

  it('rejects malformed URLs', () => {
    expect(policy.shouldConnect(
      { url: 'not-a-url', advertiserPubkey: 'b'.repeat(64) },
      [],
      reputationMap,
      50,
    )).toBe(false)
  })
})
