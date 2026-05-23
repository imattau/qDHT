export type QDHTRequestType = 'identity' | 'content' | 'route' | 'replica'

export interface QDHTRequestAnnouncement {
  kind: 10804
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export interface QDHTRequestResponse {
  kind: 10805
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export interface QDHTRequestPayload {
  type: QDHTRequestType
  query: string
  limit: number
  ttl: number
  publisher?: string
  qkey?: string
  hash?: string
  name?: string
  mime?: string
  tag?: string
}

export interface QDHTRequestResponsePayload {
  requestId: string
  requestType: QDHTRequestType
  query: string
  limit: number
  announcements: string[]
  replicas: string[]
  routes: string[]
}

export function buildRequestAnnouncement(opts: {
  pubkey: string
  type: QDHTRequestType
  query: string
  limit?: number
  ttl?: number
  publisher?: string
  qkey?: string
  hash?: string
  name?: string
  mime?: string
  tag?: string
}): QDHTRequestAnnouncement {
  const payload: QDHTRequestPayload = {
    type: opts.type,
    query: opts.query,
    limit: opts.limit ?? 25,
    ttl: opts.ttl ?? 300,
    publisher: opts.publisher,
    qkey: opts.qkey,
    hash: opts.hash,
    name: opts.name,
    mime: opts.mime,
    tag: opts.tag,
  }

  const tags = [
    ['type', payload.type],
    ['query', payload.query],
    ['limit', String(payload.limit)],
    ['ttl', String(payload.ttl)],
  ]

  if (payload.publisher) tags.push(['publisher', payload.publisher])
  if (payload.qkey) tags.push(['qkey', payload.qkey])
  if (payload.hash) tags.push(['hash', payload.hash])
  if (payload.name) tags.push(['name', payload.name])
  if (payload.mime) tags.push(['mime', payload.mime])
  if (payload.tag) tags.push(['tag', payload.tag])

  return {
    kind: 10804,
    pubkey: opts.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(payload),
    sig: '',
  }
}

export function isValidRequestAnnouncement(value: unknown): value is QDHTRequestAnnouncement {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  if (candidate.kind !== 10804 || typeof candidate.pubkey !== 'string' || !Array.isArray(candidate.tags)) {
    return false
  }

  const payload = parseRequestAnnouncement(candidate)
  return payload !== null
}

export function parseRequestAnnouncement(value: unknown): QDHTRequestPayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>
  try {
    const payload = typeof candidate.content === 'string'
      ? JSON.parse(candidate.content) as Partial<QDHTRequestPayload>
      : null
    if (
      payload &&
      (payload.type === 'identity' || payload.type === 'content' || payload.type === 'route' || payload.type === 'replica') &&
      typeof payload.query === 'string' &&
      payload.query.length > 0 &&
      typeof payload.limit === 'number' &&
      Number.isFinite(payload.limit) &&
      payload.limit > 0 &&
      typeof payload.ttl === 'number' &&
      Number.isFinite(payload.ttl) &&
      payload.ttl > 0
    ) {
      return payload as QDHTRequestPayload
    }
  } catch {
    return null
  }
  return null
}

export function getRequestTag(request: QDHTRequestAnnouncement, name: string): string | undefined {
  return request.tags.find((tag) => tag[0] === name)?.[1]
}

export function buildRequestResponse(opts: {
  pubkey: string
  requestId: string
  requestType: QDHTRequestType
  query: string
  limit: number
  announcements: string[]
  replicas: string[]
  routes: string[]
}): QDHTRequestResponse {
  const payload: QDHTRequestResponsePayload = {
    requestId: opts.requestId,
    requestType: opts.requestType,
    query: opts.query,
    limit: opts.limit,
    announcements: opts.announcements,
    replicas: opts.replicas,
    routes: opts.routes,
  }

  return {
    kind: 10805,
    pubkey: opts.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['request', opts.requestId],
      ['type', opts.requestType],
      ['query', opts.query],
      ['limit', String(opts.limit)],
      ['count', String(opts.announcements.length + opts.replicas.length + opts.routes.length)],
    ],
    content: JSON.stringify(payload),
    sig: '',
  }
}

export function parseRequestResponse(value: unknown): QDHTRequestResponsePayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>
  try {
    const payload = typeof candidate.content === 'string'
      ? JSON.parse(candidate.content) as Partial<QDHTRequestResponsePayload>
      : null
    if (
      payload &&
      (payload.requestType === 'identity' || payload.requestType === 'content' || payload.requestType === 'route' || payload.requestType === 'replica') &&
      typeof payload.requestId === 'string' &&
      payload.requestId.length > 0 &&
      typeof payload.query === 'string' &&
      typeof payload.limit === 'number' &&
      Number.isFinite(payload.limit) &&
      payload.limit >= 0 &&
      Array.isArray(payload.announcements) &&
      Array.isArray(payload.replicas) &&
      Array.isArray(payload.routes) &&
      payload.announcements.every((item) => typeof item === 'string') &&
      payload.replicas.every((item) => typeof item === 'string') &&
      payload.routes.every((item) => typeof item === 'string')
    ) {
      return payload as QDHTRequestResponsePayload
    }
  } catch {
    return null
  }
  return null
}

export function isValidRequestResponse(value: unknown): value is QDHTRequestResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return candidate.kind === 10805 && typeof candidate.pubkey === 'string' && Array.isArray(candidate.tags) && parseRequestResponse(candidate) !== null
}
