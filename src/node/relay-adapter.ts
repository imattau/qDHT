import { SimplePool } from 'nostr-tools/pool'
import type { Filter } from 'nostr-tools/filter'
import { isSignedEvent, type SignedNostrEvent } from '../core/nostr/event.js'
import { type NostrFilter } from '../core/nostr/filter.js'
import type { Transport } from './transport.js'

const DEFAULT_KINDS = [10800, 10801, 10802, 10803, 20800, 20801]

export interface RelayAdapterOptions {
  privkey: string
  relayUrls: string[]
  filter?: NostrFilter
}

export class RelayAdapter implements Transport {
  private readonly pool: SimplePool
  private readonly filter: NostrFilter
  private subscription: { close: () => void } | null = null
  private messageHandlers: Array<(msg: unknown, peerId: string) => void> = []
  private peerConnectedHandlers: Array<(peerId: string) => void> = []
  private peerDisconnectedHandlers: Array<(peerId: string) => void> = []
  private closed = false

  constructor(private readonly opts: RelayAdapterOptions) {
    this.pool = new SimplePool({ enableReconnect: true })
    this.filter = opts.filter ?? { kinds: DEFAULT_KINDS }
  }

  async connect(): Promise<void> {
    if (this.closed || this.subscription || this.opts.relayUrls.length === 0) {
      return
    }

    this.subscription = this.pool.subscribeMany(this.opts.relayUrls, this.filter as unknown as Filter, {
      onevent: (event) => this.handleEvent(event as SignedNostrEvent),
    })
  }

  onMessage(handler: (msg: unknown, peerId: string) => void): void {
    this.messageHandlers.push(handler)
  }

  onPeerConnected(handler: (peerId: string) => void): void {
    this.peerConnectedHandlers.push(handler)
  }

  onPeerDisconnected(handler: (peerId: string) => void): void {
    this.peerDisconnectedHandlers.push(handler)
  }

  broadcast(msg: unknown, _excludePeerId?: string): void {
    if (!this.isPublishable(msg)) {
      return
    }

    this.publish(msg)
  }

  send(peerId: string, msg: unknown): void {
    void peerId
    if (!this.isPublishable(msg)) {
      return
    }

    this.publish(msg)
  }

  async close(): Promise<void> {
    this.closed = true
    this.subscription?.close()
    this.subscription = null
    this.pool.close(this.opts.relayUrls)
  }

  private handleEvent(event: SignedNostrEvent): void {
    if (!DEFAULT_KINDS.includes(event.kind)) {
      return
    }
    if (typeof event.pubkey !== 'string' || event.pubkey.length === 0) {
      return
    }

    for (const handler of this.messageHandlers) {
      handler(event, event.pubkey)
    }
  }

  private isPublishable(msg: unknown): msg is SignedNostrEvent {
    return isSignedEvent(msg as SignedNostrEvent)
  }

  private publish(event: SignedNostrEvent): void {
    try {
      for (const promise of this.pool.publish(this.opts.relayUrls, event)) {
        void promise.catch(() => undefined)
      }
    } catch {
      // Ignore relay publish failures for best-effort fan-out.
    }
  }
}
