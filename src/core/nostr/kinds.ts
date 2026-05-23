export const QDHT_KIND = {
  ANNOUNCEMENT: 10800,
  REPLICA_RECORD: 10801,
  REPUTATION_DELTA: 10802,
  PIECE_MANIFEST: 10803,
  REQUEST_ANNOUNCEMENT: 10804,
  REQUEST_RESPONSE: 10805,
  DELTA_REQUEST: 20800,
  DELTA_RESPONSE: 20801,
} as const

export type QDHTKind = (typeof QDHT_KIND)[keyof typeof QDHT_KIND]

const VALID_KINDS = new Set<number>(Object.values(QDHT_KIND))

export function isQDHTKind(kind: number): kind is QDHTKind {
  return VALID_KINDS.has(kind)
}
