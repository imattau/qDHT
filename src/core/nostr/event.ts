export interface NostrEvent {
  kind: number
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export interface SignedNostrEvent extends NostrEvent {
  id: string
  sig: string
}

export function isSignedEvent(event: NostrEvent): event is SignedNostrEvent {
  const candidate = event as Partial<SignedNostrEvent>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length === 64 &&
    typeof candidate.sig === 'string' &&
    candidate.sig.length === 128
  )
}
