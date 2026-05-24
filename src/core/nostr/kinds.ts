export const QDHT_KIND = {
  ANNOUNCEMENT: 10800,
  REPLICA_RECORD: 10801,
  REPUTATION_DELTA: 10802,
  PIECE_MANIFEST: 10803,
  REQUEST_ANNOUNCEMENT: 10804,
  REQUEST_RESPONSE: 10805,
  DELTA_REQUEST: 20800,
  DELTA_RESPONSE: 20801,
  NODE_PROFILE: 30180,
  SERVICE_RECORD: 30181,
} as const

export type QDHTKind = (typeof QDHT_KIND)[keyof typeof QDHT_KIND]

export interface QDHTKindRow {
  kind_id: number
  name: string
  category: 'content' | 'request' | 'routing' | 'reputation' | 'transport'
  searchable: number
  description: string
}

export const QDHT_KIND_ROWS: QDHTKindRow[] = [
  { kind_id: QDHT_KIND.ANNOUNCEMENT, name: 'announcement', category: 'content', searchable: 1, description: 'Content announcement' },
  { kind_id: QDHT_KIND.REPLICA_RECORD, name: 'replica_record', category: 'content', searchable: 1, description: 'Replica / provider record' },
  { kind_id: QDHT_KIND.REPUTATION_DELTA, name: 'reputation_delta', category: 'reputation', searchable: 0, description: 'Reputation adjustment event' },
  { kind_id: QDHT_KIND.PIECE_MANIFEST, name: 'piece_manifest', category: 'content', searchable: 1, description: 'Piece manifest for swarming' },
  { kind_id: QDHT_KIND.REQUEST_ANNOUNCEMENT, name: 'request_announcement', category: 'request', searchable: 1, description: 'Metadata or route search request' },
  { kind_id: QDHT_KIND.REQUEST_RESPONSE, name: 'request_response', category: 'request', searchable: 0, description: 'Metadata or route search response' },
  { kind_id: QDHT_KIND.DELTA_REQUEST, name: 'delta_request', category: 'transport', searchable: 0, description: 'Delta sync request' },
  { kind_id: QDHT_KIND.DELTA_RESPONSE, name: 'delta_response', category: 'transport', searchable: 0, description: 'Delta sync response' },
  { kind_id: QDHT_KIND.NODE_PROFILE, name: 'node_profile', category: 'routing', searchable: 1, description: 'Node capability profile' },
  { kind_id: QDHT_KIND.SERVICE_RECORD, name: 'service_record', category: 'routing', searchable: 1, description: 'Peer endpoint and transport info' },
]

export const NOSTR_KIND_ROWS: QDHTKindRow[] = [
  ...QDHT_KIND_ROWS,
  { kind_id: 30800, name: 'observed_address', category: 'routing', searchable: 1, description: 'Peer-observed endpoint report' },
  { kind_id: 30801, name: 'route_announcement', category: 'routing', searchable: 1, description: 'Signed route announcement' },
]

const VALID_KINDS = new Set<number>(Object.values(QDHT_KIND))

export function isQDHTKind(kind: number): kind is QDHTKind {
  return VALID_KINDS.has(kind)
}
