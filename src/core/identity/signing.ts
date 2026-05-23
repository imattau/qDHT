import { finalizeEvent, getEventHash, verifyEvent as verifyNostrEvent } from 'nostr-tools/pure'
import { type QDHTAnnouncement } from '../protocol/announcement.js'
import { type NostrEvent, type SignedNostrEvent } from '../nostr/event.js'

function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(`privkey must be 64 hex chars, got ${hex.length}`)
  }

  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

export function eventId(event: NostrEvent): string {
  return getEventHash({
    kind: event.kind,
    pubkey: event.pubkey,
    created_at: event.created_at,
    tags: event.tags,
    content: event.content,
  })
}

export function signEvent(event: NostrEvent, privkeyHex: string): SignedNostrEvent {
  const privkeyBytes = hexToBytes(privkeyHex)
  const finalized = finalizeEvent(
    {
      kind: event.kind,
      created_at: event.created_at,
      tags: event.tags,
      content: event.content,
    },
    privkeyBytes,
  )

  return {
    kind: finalized.kind,
    pubkey: finalized.pubkey,
    created_at: finalized.created_at,
    tags: finalized.tags,
    content: finalized.content,
    id: finalized.id,
    sig: finalized.sig,
  }
}

export function verifyEvent(event: SignedNostrEvent): boolean {
  try {
    return verifyNostrEvent(event)
  } catch {
    return false
  }
}

export function signAnnouncement(announcement: QDHTAnnouncement, privkeyHex: string): SignedNostrEvent {
  return signEvent(
    {
      kind: announcement.kind,
      pubkey: announcement.pubkey,
      created_at: announcement.created_at,
      tags: announcement.tags,
      content: announcement.content,
      sig: '',
    },
    privkeyHex,
  )
}
