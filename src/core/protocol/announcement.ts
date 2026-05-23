export interface QDHTAnnouncement {
  kind: 10800
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export function buildAnnouncement(opts: {
  pubkey: string
  qkey: string
  hash: string
  sizeBytes: number
  pieces: number
  pieceSize: number
  ttl: number
  mime?: string
  name?: string
  url?: string
}): QDHTAnnouncement {
  const tags = [
    ['qkey', opts.qkey],
    ['hash', opts.hash],
    ['size', String(opts.sizeBytes)],
    ['pieces', String(opts.pieces)],
    ['piece_size', String(opts.pieceSize)],
    ['ttl', String(opts.ttl)],
  ]
  if (opts.mime) {
    tags.push(['mime', opts.mime])
  }
  if (opts.url) {
    tags.push(['url', opts.url])
    tags.push(['r', opts.url])
  }

  return {
    kind: 10800,
    pubkey: opts.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: opts.name ? JSON.stringify({ name: opts.name }) : '',
    sig: '',
  }
}

export function isValidAnnouncement(value: unknown): value is QDHTAnnouncement {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return candidate.kind === 10800 && typeof candidate.pubkey === 'string' && Array.isArray(candidate.tags)
}

export function getTag(announcement: QDHTAnnouncement, name: string): string | undefined {
  return announcement.tags.find((tag) => tag[0] === name)?.[1]
}
