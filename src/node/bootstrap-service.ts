import { verifyEvent, signEvent } from '../core/identity/signing.js'
import { isSignedEvent } from '../core/nostr/event.js'
import { QDHT_KIND } from '../core/nostr/kinds.js'
import type { SignedNostrEvent } from '../core/nostr/event.js'

const DEFAULT_MAX_PEERS = 10_000
const EVICTION_INTERVAL_MS = 60_000

export interface BootstrapServiceOptions {
  pubkey: string
  privkey: string
  maxPeers?: number
}

type SendFn = (msg: unknown) => void

export class BootstrapService {
  private readonly pubkey: string
  private readonly privkey: string
  private readonly maxPeers: number
  private cache = new Map<string, SignedNostrEvent>()
  private evictionTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: BootstrapServiceOptions) {
    this.pubkey = opts.pubkey
    this.privkey = opts.privkey
    this.maxPeers = opts.maxPeers ?? DEFAULT_MAX_PEERS
    this.evictionTimer = setInterval(() => this.evictExpired(), EVICTION_INTERVAL_MS)
  }

  /** Call when a peer successfully completes a handshake and connects. */
  onPeerConnected(peerId: string, remoteAddress: string, send: SendFn): void {
    // Send all cached 30181 events to the new peer
    for (const event of this.cache.values()) {
      send(event)
    }
    // Reflect observed address via kind 30800
    const now = Math.floor(Date.now() / 1000)
    const ip = this.extractIp(remoteAddress)
    const reflection = signEvent(
      {
        kind: 30800,
        pubkey: this.pubkey,
        created_at: now,
        tags: [['p', peerId]],
        content: ip,
        sig: '',
      },
      this.privkey,
    )
    send(reflection)
  }

  /** Call when a peer disconnects to remove their service record from the cache. */
  onPeerDisconnected(peerId: string): void {
    this.cache.delete(peerId)
  }

  /**
   * Process an incoming message from a peer.
   * @param event The parsed event object.
   * @param fromPeerId The pubkey of the sending peer.
   * @param broadcast Called with each event that should be forwarded to all OTHER peers.
   * @param reply Called with messages to send back only to the originating peer.
   */
  handleEvent(event: unknown, fromPeerId: string, broadcast: SendFn, reply?: SendFn): void {
    if (!event || typeof event !== 'object') {
      return
    }
    const e = event as Record<string, unknown>

    // Handle delta catch-up
    if (e.kind === QDHT_KIND.DELTA_REQUEST) {
      if (reply) {
        this.handleDeltaRequest(fromPeerId, reply)
      }
      return
    }

    if (e.kind !== QDHT_KIND.SERVICE_RECORD) {
      return
    }

    const candidate = event as SignedNostrEvent

    // Verify signature
    if (!isSignedEvent(candidate) || !verifyEvent(candidate)) {
      return
    }

    // Discard own pubkey
    if (candidate.pubkey === this.pubkey) {
      return
    }

    // Discard if expired
    if (this.isExpired(candidate)) {
      return
    }

    // Upsert: only accept if strictly newer
    const existing = this.cache.get(candidate.pubkey)
    if (existing && existing.created_at >= candidate.created_at) {
      return
    }

    // Evict oldest if at capacity (and this is a new pubkey, not an update)
    if (!existing && this.cache.size >= this.maxPeers) {
      this.evictOldest()
    }

    this.cache.set(candidate.pubkey, candidate)
    broadcast(candidate)
  }

  stop(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer)
      this.evictionTimer = null
    }
  }

  /** Test helpers */
  cacheSize(): number {
    return this.cache.size
  }

  hasCached(pubkey: string): boolean {
    return this.cache.has(pubkey)
  }

  private handleDeltaRequest(fromPeerId: string, reply: SendFn): void {
    const now = Math.floor(Date.now() / 1000)
    const eventIds = [...this.cache.values()].map((e) => e.id)
    const response = signEvent(
      {
        kind: QDHT_KIND.DELTA_RESPONSE,
        pubkey: this.pubkey,
        created_at: now,
        tags: [['p', fromPeerId]],
        content: JSON.stringify({ eventIds }),
        sig: '',
      },
      this.privkey,
    )
    reply(response)
  }

  private isExpired(event: SignedNostrEvent): boolean {
    const expirationTag = event.tags.find(([k]) => k === 'expiration')
    if (!expirationTag) {
      return false
    }
    const ttlSeconds = Number(expirationTag[1])
    if (!Number.isFinite(ttlSeconds)) {
      return false
    }
    const now = Math.floor(Date.now() / 1000)
    return event.created_at + ttlSeconds <= now
  }

  private evictExpired(): void {
    for (const [pubkey, event] of this.cache) {
      if (this.isExpired(event)) {
        this.cache.delete(pubkey)
      }
    }
  }

  private evictOldest(): void {
    let oldestPubkey: string | null = null
    let oldestTime = Infinity
    for (const [pubkey, event] of this.cache) {
      if (event.created_at < oldestTime) {
        oldestTime = event.created_at
        oldestPubkey = pubkey
      }
    }
    if (oldestPubkey) {
      this.cache.delete(oldestPubkey)
    }
  }

  private extractIp(address: string): string {
    // address may be "ws://1.2.3.4:9999" or "::1" or "1.2.3.4:9999"
    try {
      if (address.startsWith('ws://') || address.startsWith('wss://')) {
        return new URL(address).hostname
      }
    } catch {
      // fall through
    }
    // "ip:port" format
    const colonIdx = address.lastIndexOf(':')
    if (colonIdx > 0 && !address.includes('[')) {
      return address.slice(0, colonIdx)
    }
    return address
  }
}
