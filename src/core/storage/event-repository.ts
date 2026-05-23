import type { NostrEvent } from '../nostr/event.js'

export interface StoredNostrEvent extends NostrEvent {
  id?: string
}

export interface NostrEventRepository {
  upsert(event: StoredNostrEvent): void
  loadAll(): StoredNostrEvent[]
  loadSince(createdAt: number): StoredNostrEvent[]
  close(): void
}
