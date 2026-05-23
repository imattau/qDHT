export interface QDHTReplicaRecord {
  kind: 10801
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export function buildReplicaRecord(opts: {
  pubkey: string
  qkey: string
  hash: string
  provider: string
  complete: boolean
  ttl: number
  pieceRanges?: [number, number][]
  latency?: number
}): QDHTReplicaRecord {
  const tags = [
    ['qkey', opts.qkey],
    ['hash', opts.hash],
    ['provider', opts.provider],
    ['complete', opts.complete ? 'true' : 'false'],
    ['ttl', String(opts.ttl)],
  ]
  if (opts.latency !== undefined) {
    tags.push(['latency', String(opts.latency)])
  }

  return {
    kind: 10801,
    pubkey: opts.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: opts.pieceRanges ? JSON.stringify({ pieceRanges: opts.pieceRanges }) : '',
    sig: '',
  }
}
