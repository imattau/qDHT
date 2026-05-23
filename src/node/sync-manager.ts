import { isSignedEvent, type SignedNostrEvent } from '../core/nostr/event.js'
import { verifyEvent, signAnnouncement } from '../core/identity/signing.js'
import { NeighbourStateMap } from '../core/neighbour-state.js'
import { Propagator } from '../core/propagation/propagator.js'
import { buildAnnouncement, isValidAnnouncement } from '../core/protocol/announcement.js'
import { buildDeltaRequest, buildDeltaResponse } from '../core/protocol/delta.js'
import { getTag } from '../core/nostr/tags.js'
import type { Transport } from './transport.js'

export interface SyncManagerOptions {
  pubkey: string
  privkey: string
  propagator: Propagator
  neighbourState: NeighbourStateMap
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

  constructor(private opts: SyncManagerOptions) {
    for (const transport of this.opts.transports) {
      transport.onMessage((msg, peerId) => this.handleMessage(msg, peerId))
      transport.onPeerConnected((peerId) => this.onPeerConnected(peerId))
      transport.onPeerDisconnected((peerId) => this.peerLastSeen.delete(peerId))
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
    this.eventLog.set(signed.id, signed)
    this.opts.propagator.addNote(signed.id, this.opts.pubkey, signed.pubkey, signed.created_at)
    this.broadcast(signed)
    return signed
  }

  sendDeltaRequest(peerId: string, since?: number): void {
    const req = buildDeltaRequest({
      pubkey: this.opts.pubkey,
      since: since ?? this.peerLastSeen.get(peerId) ?? 0,
    })
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

  private handleAnnouncement(event: AnyEvent, fromPeerId: string): void {
    if (!isValidAnnouncement(event)) {
      return
    }
    if (isSignedEvent(event) && !verifyEvent(event)) {
      return
    }

    const id = (event as AnyEvent & { id?: string }).id ?? `${event.pubkey}-${event.created_at}`
    const qkey = getTag(event.tags, 'qkey') ?? id
    const hash = getTag(event.tags, 'hash') ?? ''
    this.eventLog.set(id, event)
    this.opts.propagator.addNote(id, fromPeerId, event.pubkey, event.created_at)
    this.opts.neighbourState.recordInbound(qkey, hash, id, fromPeerId, event.created_at)
    this.broadcast(event, fromPeerId)
  }

  private handleReplica(event: AnyEvent, fromPeerId: string): void {
    const id = (event as AnyEvent & { id?: string }).id ?? `${event.pubkey}-${event.created_at}`
    this.eventLog.set(id, event)
    const qkey = getTag(event.tags, 'qkey')
    if (qkey) {
      this.opts.neighbourState.recordInbound(qkey, getTag(event.tags, 'hash') ?? '', id, fromPeerId, event.created_at)
    }
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
        if (!this.eventLog.has(id)) {
          this.eventLog.set(id, ann)
        }
      }
      for (const raw of payload.replicas) {
        const replica = JSON.parse(raw) as AnyEvent
        const id = (replica as AnyEvent & { id?: string }).id ?? `${replica.pubkey}-${replica.created_at}`
        if (!this.eventLog.has(id)) {
          this.eventLog.set(id, replica)
        }
      }
    } catch {
      return
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
