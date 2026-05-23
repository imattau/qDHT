import { signAnnouncement } from '../identity/signing.js'
import { type QDHTAnnouncement } from '../protocol/announcement.js'
import { matchesFilter, type NostrFilter } from './filter.js'
import { type NostrEvent, type SignedNostrEvent } from './event.js'

export interface RelayTransport {
  publish(event: SignedNostrEvent): void | Promise<void>
}

export interface LiveNodeAdapterOptions {
  privkeyHex: string
  publishFilters?: NostrFilter[]
}

/**
 * Minimal live-node seam for Phase 3.
 * - signs outbound qDHT announcements
 * - gates inbound events through Nostr filter matching
 */
export class LiveNodeAdapter {
  private publishFilters: NostrFilter[]

  constructor(
    private transport: RelayTransport,
    private options: LiveNodeAdapterOptions,
  ) {
    this.publishFilters = options.publishFilters ?? []
  }

  async publishAnnouncement(announcement: QDHTAnnouncement): Promise<SignedNostrEvent> {
    const signed = signAnnouncement(announcement, this.options.privkeyHex)
    await this.transport.publish(signed)
    return signed
  }

  accepts(event: NostrEvent, filters: NostrFilter[] = this.publishFilters): boolean {
    if (filters.length === 0) {
      return true
    }
    return filters.some((filter) => matchesFilter(event, filter))
  }
}
