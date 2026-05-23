import { isSignedEvent, type SignedNostrEvent } from '../core/nostr/event.js'
import { verifyEvent, signAnnouncement, signEvent } from '../core/identity/signing.js'
import { NeighbourStateMap } from '../core/neighbour-state.js'
import { Propagator } from '../core/propagation/propagator.js'
import { buildAnnouncement, isValidAnnouncement } from '../core/protocol/announcement.js'
import { buildDeltaRequest, buildDeltaResponse, buildReputationDelta } from '../core/protocol/delta.js'
import { buildRequestAnnouncement, buildRequestResponse, isValidRequestAnnouncement, isValidRequestResponse, parseRequestAnnouncement, parseRequestResponse, type QDHTRequestPayload, type QDHTRequestResponsePayload } from '../core/protocol/request.js'
import { getTag } from '../core/nostr/tags.js'
import { type NostrEventRepository, type StoredNostrEvent } from '../core/storage/event-repository.js'
import { ReputationMap } from '../core/protocol/reputation.js'
import { REACHABILITY_KIND, normalizeIdentityRef, parseObservedAddressEvent, parseRouteAnnouncement, signRouteAnnouncement, type RouteAnnouncement } from '../core/discovery/reachability.js'
import type { Transport } from './transport.js'

export interface SyncManagerOptions {
  pubkey: string
  privkey: string
  propagator: Propagator
  neighbourState: NeighbourStateMap
  reputationMap: ReputationMap
  eventStore: NostrEventRepository
  ownsEventStore?: boolean
  transports: Transport[]
}

type AnyEvent = {
  kind: number
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
  id?: string
}

export class SyncManager {
  private eventLog = new Map<string, AnyEvent>()
  private peerLastSeen = new Map<string, number>()
  private requestResponses = new Map<string, QDHTRequestResponsePayload>()
  private readonly eventStore: NostrEventRepository
  private readonly ownsEventStore: boolean
  private closed = false

  constructor(private opts: SyncManagerOptions) {
    this.eventStore = this.opts.eventStore
    this.ownsEventStore = this.opts.ownsEventStore ?? false
    this.hydrateEventStore()
    for (const transport of this.opts.transports) {
      transport.onMessage((msg, peerId) => this.handleMessage(msg, peerId))
      transport.onPeerConnected((peerId) => this.onPeerConnected(peerId))
      transport.onPeerDisconnected((peerId) => this.peerLastSeen.delete(peerId))
    }
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    if (this.ownsEventStore) {
      this.eventStore.close()
    }
  }

  handleMessage(msg: unknown, fromPeerId: string): void {
    if (!msg || typeof msg !== 'object') {
      return
    }

    const event = msg as AnyEvent
    this.peerLastSeen.set(fromPeerId, Math.max(this.peerLastSeen.get(fromPeerId) ?? 0, event.created_at ?? 0))

    switch (event.kind) {
      case 10800:
        this.handleAnnouncement(event, fromPeerId)
        break
      case 10801:
        this.handleReplica(event, fromPeerId)
        break
      case 10804:
        this.handleRequestAnnouncement(event, fromPeerId)
        break
      case 10805:
        this.handleRequestResponse(event)
        break
      case REACHABILITY_KIND.OBSERVED_ADDRESS:
        this.handleObservedAddress(event)
        break
      case REACHABILITY_KIND.ROUTE_ANNOUNCEMENT:
        this.handleRouteAnnouncement(event, fromPeerId)
        break
      case 20800:
        this.handleDeltaRequest(event, fromPeerId)
        break
      case 20801:
        this.handleDeltaResponse(event)
        break
    }
  }

  publishAnnouncement(opts: {
    qkey: string
    hash: string
    sizeBytes: number
    pieces: number
    pieceSize: number
    ttl: number
    mime?: string
    name?: string
  }): SignedNostrEvent {
    const announcement = buildAnnouncement({
      pubkey: this.opts.pubkey,
      ...opts,
    })
    const signed = signAnnouncement(announcement, this.opts.privkey)
    this.recordEvent(signed)
    this.opts.propagator.addNote(signed.id, this.opts.pubkey, signed.pubkey, signed.created_at)
    this.broadcast(signed)
    return signed
  }

  async searchRequest(
    opts: QDHTRequestPayload,
    timeoutMs = 2_000,
  ): Promise<QDHTRequestResponsePayload | null> {
    const request = this.publishRequestAnnouncement(opts)
    const requestId = request.id
    const localResponse = this.buildLocalRequestResponse(request, opts)
    if (localResponse) {
      const parsed = parseRequestResponse(localResponse)
      if (parsed) {
        this.requestResponses.set(parsed.requestId, parsed)
        return parsed
      }
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return this.requestResponses.get(requestId) ?? null
    }

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const response = this.requestResponses.get(requestId)
      if (response) {
        return response
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    return this.requestResponses.get(requestId) ?? null
  }

  sendDeltaRequest(peerId: string, since?: number): void {
    const req = buildDeltaRequest({
      pubkey: this.opts.pubkey,
      since: since ?? this.peerLastSeen.get(peerId) ?? 0,
    })
    this.recordEvent(req)
    this.send(peerId, req)
  }

  onPeerConnected(peerId: string): void {
    this.sendDeltaRequest(peerId, this.peerLastSeen.get(peerId) ?? 0)
  }

  getAnnouncementInfo(qkey: string): {
    hash: string
    totalPieces: number
    pieceSize: number
    sourceUrl?: string
    name?: string
    mime?: string
  } | null {
    for (const event of this.eventLog.values()) {
      if (event.kind !== 10800) {
        continue
      }
      const eventQkey = getTag(event.tags, 'qkey') ?? (event as AnyEvent & { id?: string }).id
      if (eventQkey !== qkey) {
        continue
      }
      const hash = getTag(event.tags, 'hash')
      const pieces = Number(getTag(event.tags, 'pieces') ?? '0')
      const pieceSize = Number(getTag(event.tags, 'piece_size') ?? '0')
      if (!hash || !Number.isFinite(pieces) || !Number.isFinite(pieceSize)) {
        return null
      }
      return {
        hash,
        totalPieces: pieces,
        pieceSize,
        sourceUrl: getTag(event.tags, 'url') ?? getTag(event.tags, 'r'),
        name: event.content
          ? (() => {
              try {
                return (JSON.parse(event.content) as { name?: string }).name
              } catch {
                return undefined
              }
            })()
          : undefined,
        mime: getTag(event.tags, 'mime'),
      }
    }
    return null
  }

  publishRequestAnnouncement(opts: QDHTRequestPayload): SignedNostrEvent {
    const request = signEvent(
      buildRequestAnnouncement({
        pubkey: this.opts.pubkey,
        type: opts.type,
        query: opts.query,
        limit: opts.limit,
        ttl: opts.ttl,
        publisher: opts.publisher,
        qkey: opts.qkey,
        hash: opts.hash,
        name: opts.name,
        mime: opts.mime,
        tag: opts.tag,
      }),
      this.opts.privkey,
    )
    this.recordEvent(request)
    this.broadcast(request)
    return request
  }

  publishRouteAnnouncement(route: RouteAnnouncement): SignedNostrEvent {
    const signed = signRouteAnnouncement(route, this.opts.privkey)
    this.recordEvent(signed)
    this.broadcast(signed)
    return signed
  }

  private handleAnnouncement(event: AnyEvent, fromPeerId: string): void {
    if (!isValidAnnouncement(event)) {
      return
    }
    if (isSignedEvent(event) && !verifyEvent(event)) {
      this.opts.reputationMap.adjust(event.pubkey, -0.1)
      this.broadcastReputationDelta(event.pubkey, -0.1)
      return
    }

    const id = (event as AnyEvent & { id?: string }).id ?? `${event.pubkey}-${event.created_at}`
    const qkey = getTag(event.tags, 'qkey') ?? id
    const hash = getTag(event.tags, 'hash') ?? ''
    this.recordEvent({ ...event, id })
    this.opts.propagator.addNote(id, fromPeerId, event.pubkey, event.created_at)
    this.opts.neighbourState.recordInbound(qkey, hash, id, fromPeerId, event.created_at)
    this.broadcast(event, fromPeerId)
  }

  private handleReplica(event: AnyEvent, fromPeerId: string): void {
    const id = (event as AnyEvent & { id?: string }).id ?? `${event.pubkey}-${event.created_at}`
    this.recordEvent({ ...event, id })
    const qkey = getTag(event.tags, 'qkey')
    if (qkey) {
      this.opts.neighbourState.recordInbound(qkey, getTag(event.tags, 'hash') ?? '', id, fromPeerId, event.created_at)
    }
  }

  private handleRequestAnnouncement(event: AnyEvent, fromPeerId: string): void {
    if (!isValidRequestAnnouncement(event)) {
      return
    }
    const id = (event as AnyEvent & { id?: string }).id ?? `${event.pubkey}-${event.created_at}`
    this.recordEvent({ ...event, id })
    this.opts.propagator.addNote(id, fromPeerId, event.pubkey, event.created_at)
    this.broadcast(event, fromPeerId)

    const payload = parseRequestAnnouncement(event)
    if (!payload) {
      return
    }
    const response = this.buildRequestResponse(event, payload)
    if (!response) {
      return
    }
    this.recordEvent(response)
    this.send(fromPeerId, response)
  }

  private handleRequestResponse(event: AnyEvent): void {
    if (!isValidRequestResponse(event)) {
      return
    }
    const id = (event as AnyEvent & { id?: string }).id ?? `${event.pubkey}-${event.created_at}`
    this.recordEvent({ ...event, id })
    const parsed = parseRequestResponse(event)
    if (parsed) {
      this.requestResponses.set(parsed.requestId, parsed)
    }
  }

  private handleObservedAddress(event: AnyEvent): void {
    const signed = event as StoredNostrEvent
    if (!parseObservedAddressEvent(signed as SignedNostrEvent)) {
      return
    }
    this.recordEvent(signed)
  }

  private handleRouteAnnouncement(event: AnyEvent, fromPeerId: string): void {
    const signed = event as StoredNostrEvent
    if (!parseRouteAnnouncement(signed)) {
      return
    }

    const id = (signed as AnyEvent & { id?: string }).id ?? `${signed.pubkey}-${signed.created_at}`
    this.recordEvent({ ...signed, id })
    this.opts.propagator.addNote(id, fromPeerId, signed.pubkey, signed.created_at)
    this.broadcast(signed, fromPeerId)
  }

  private buildRequestResponse(event: AnyEvent, payload: QDHTRequestPayload): AnyEvent | null {
    const requestId = (event as AnyEvent & { id?: string }).id ?? `${event.pubkey}-${event.created_at}`
    const limit = Math.max(0, payload.limit)
    const query = payload.query.trim()
    const identityHint = normalizeIdentityRef(query)?.identity ?? query.toLowerCase()
    const announcementMatches = this.matchAnnouncements(payload, limit)
    const replicaMatches = this.matchReplicaRecords(payload, limit)
    const routeMatches = this.matchRoutes(payload, identityHint, limit, announcementMatches)

    if (announcementMatches.length === 0 && replicaMatches.length === 0 && routeMatches.length === 0) {
      return null
    }

    return buildRequestResponse({
      pubkey: this.opts.pubkey,
      requestId,
      requestType: payload.type,
      query: payload.query,
      limit,
      announcements: announcementMatches,
      replicas: replicaMatches,
      routes: routeMatches,
    })
  }

  private buildLocalRequestResponse(request: SignedNostrEvent, payload: QDHTRequestPayload): AnyEvent | null {
    return this.buildRequestResponse(request, payload)
  }

  private matchAnnouncements(payload: QDHTRequestPayload, limit: number): string[] {
    const query = payload.query.trim().toLowerCase()
    const matches: string[] = []
    for (const event of this.eventLog.values()) {
      if (event.kind !== 10800) {
        continue
      }
      if (payload.publisher && event.pubkey !== payload.publisher) {
        continue
      }
      const tags = new Map(event.tags.map((tag) => [tag[0], tag[1]]))
      const haystack = [
        event.pubkey,
        event.content,
        tags.get('qkey') ?? '',
        tags.get('hash') ?? '',
        tags.get('name') ?? '',
        tags.get('mime') ?? '',
        tags.get('url') ?? '',
        tags.get('r') ?? '',
        tags.get('tag') ?? '',
      ].join(' ').toLowerCase()
      if (!haystack.includes(query) && tags.get('qkey') !== payload.qkey && tags.get('hash') !== payload.hash) {
        continue
      }
      matches.push(JSON.stringify(event))
      if (matches.length >= limit) {
        break
      }
    }
    return matches
  }

  private matchReplicaRecords(payload: QDHTRequestPayload, limit: number): string[] {
    const query = payload.query.trim().toLowerCase()
    const matches: string[] = []
    for (const event of this.eventLog.values()) {
      if (event.kind !== 10801) {
        continue
      }
      const tags = new Map(event.tags.map((tag) => [tag[0], tag[1]]))
      const haystack = [
        event.pubkey,
        event.content,
        tags.get('qkey') ?? '',
        tags.get('hash') ?? '',
        tags.get('provider') ?? '',
      ].join(' ').toLowerCase()
      if (!haystack.includes(query) && tags.get('qkey') !== payload.qkey && tags.get('hash') !== payload.hash && tags.get('provider') !== payload.publisher) {
        continue
      }
      matches.push(JSON.stringify(event))
      if (matches.length >= limit) {
        break
      }
    }
    return matches
  }

  private matchRoutes(payload: QDHTRequestPayload, identityHint: string, limit: number, announcementMatches: string[]): string[] {
    const matches: string[] = []
    const publisherHints = new Set<string>(payload.publisher ? [payload.publisher] : [])
    for (const raw of announcementMatches) {
      try {
        const announcement = JSON.parse(raw) as AnyEvent
        publisherHints.add(announcement.pubkey)
      } catch {
        // ignore
      }
    }

    for (const event of this.eventLog.values()) {
      if (event.kind !== 30801) {
        continue
      }
      const route = parseRouteAnnouncement(event)
      if (!route) {
        continue
      }
      const routeIdentity = route.identity.toLowerCase()
      const routePubkey = event.pubkey.toLowerCase()
      if (
        payload.type === 'content'
          ? !publisherHints.has(routePubkey) && !publisherHints.has(routeIdentity) && routeIdentity !== identityHint
          : routeIdentity !== identityHint && routePubkey !== identityHint
      ) {
        continue
      }
      matches.push(JSON.stringify(event))
      if (matches.length >= limit) {
        break
      }
    }
    return matches
  }

  private handleDeltaRequest(event: AnyEvent, fromPeerId: string): void {
    const since = Number(getTag(event.tags, 'since') ?? '0')
    const announcements: string[] = []
    const replicas: string[] = []
    const reputationDeltas: string[] = []
    const expired: string[] = []

    for (const stored of this.eventLog.values()) {
      if (stored.created_at < since) {
        continue
      }
      if (stored.kind === 10800) {
        announcements.push(JSON.stringify(stored))
      } else if (stored.kind === 10801) {
        replicas.push(JSON.stringify(stored))
      } else if (stored.kind === 10802) {
        reputationDeltas.push(JSON.stringify(stored))
      }
    }

    const response = buildDeltaResponse({
      pubkey: this.opts.pubkey,
      requestId: (event as AnyEvent & { id?: string }).id ?? '',
      since,
      announcements,
      replicas,
      reputationDeltas,
      expired,
    })
    this.recordEvent(response)
    this.send(fromPeerId, response)
  }

  private handleDeltaResponse(event: AnyEvent): void {
    try {
      const payload = JSON.parse(event.content) as {
        announcements: string[]
        replicas: string[]
        reputationDeltas: string[]
        expired: string[]
      }
      for (const raw of payload.announcements) {
        const ann = JSON.parse(raw) as AnyEvent
        const id = (ann as AnyEvent & { id?: string }).id ?? `${ann.pubkey}-${ann.created_at}`
        this.recordEvent({ ...ann, id })
      }
      for (const raw of payload.replicas) {
        const replica = JSON.parse(raw) as AnyEvent
        const id = (replica as AnyEvent & { id?: string }).id ?? `${replica.pubkey}-${replica.created_at}`
        this.recordEvent({ ...replica, id })
      }
      for (const raw of payload.reputationDeltas) {
        const delta = JSON.parse(raw) as AnyEvent
        try {
          const deltaContent = JSON.parse(delta.content) as { targetPubkey: string; delta: number }
          this.opts.reputationMap.adjust(deltaContent.targetPubkey, deltaContent.delta)
          const id = (delta as AnyEvent & { id?: string }).id ?? `${delta.pubkey}-${delta.created_at}`
          this.recordEvent({ ...delta, id })
        } catch {
          continue
        }
      }
    } catch {
      return
    }
  }

  private broadcastReputationDelta(targetPubkey: string, delta: number): void {
    const event = buildReputationDelta({
      pubkey: this.opts.pubkey,
      targetPubkey,
      delta,
    })
    const signed = signEvent(event, this.opts.privkey)
    this.recordEvent(signed)
    this.broadcast(signed)
  }

  private hydrateEventStore(): void {
    for (const event of this.eventStore.loadAll()) {
      this.rememberEvent(event)
      this.replayReputationDelta(event)
    }
  }

  private rememberEvent(event: StoredNostrEvent): void {
    const key = this.eventKey(event)
    if (!this.eventLog.has(key)) {
      this.eventLog.set(key, event)
    }
  }

  private recordEvent(event: StoredNostrEvent): void {
    const key = this.eventKey(event)
    if (!this.eventLog.has(key)) {
      this.eventLog.set(key, event)
    }
    this.eventStore.upsert(event)
  }

  private eventKey(event: StoredNostrEvent): string {
    return event.id ?? `${event.kind}-${event.pubkey}-${event.created_at}`
  }

  private replayReputationDelta(event: StoredNostrEvent): void {
    if (event.kind !== 10802) {
      return
    }

    try {
      const payload = JSON.parse(event.content) as { targetPubkey?: string; delta?: number }
      if (typeof payload.targetPubkey === 'string' && typeof payload.delta === 'number') {
        this.opts.reputationMap.adjust(payload.targetPubkey, payload.delta)
      }
    } catch {
      // Ignore malformed persisted deltas.
    }
  }

  private broadcast(msg: unknown, excludePeerId?: string): void {
    for (const transport of this.opts.transports) {
      transport.broadcast(msg, excludePeerId)
    }
  }

  private send(peerId: string, msg: unknown): void {
    for (const transport of this.opts.transports) {
      transport.send(peerId, msg)
    }
  }
}
