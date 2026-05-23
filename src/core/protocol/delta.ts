export interface DeltaRequest {
  kind: 20800
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export interface DeltaResponse {
  kind: 20801
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export interface DeltaResponseContent {
  announcements: string[]
  replicas: string[]
  reputationDeltas: string[]
  expired: string[]
}

export function buildDeltaRequest(opts: { pubkey: string; since: number; limit?: number }): DeltaRequest {
  return {
    kind: 20800,
    pubkey: opts.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['since', String(opts.since)],
      ['limit', String(opts.limit ?? 500)],
    ],
    content: '',
    sig: '',
  }
}

export function buildDeltaResponse(opts: {
  pubkey: string
  requestId: string
  since: number
  announcements: string[]
  replicas: string[]
  reputationDeltas: string[]
  expired: string[]
}): DeltaResponse {
  const content: DeltaResponseContent = {
    announcements: opts.announcements,
    replicas: opts.replicas,
    reputationDeltas: opts.reputationDeltas,
    expired: opts.expired,
  }

  return {
    kind: 20801,
    pubkey: opts.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['request', opts.requestId],
      ['since', String(opts.since)],
      ['count', String(opts.announcements.length + opts.replicas.length)],
    ],
    content: JSON.stringify(content),
    sig: '',
  }
}


export interface ReputationDelta {
  kind: 10802
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export interface ReputationDeltaContent {
  targetPubkey: string
  delta: number
}

export function buildReputationDelta(opts: { pubkey: string; targetPubkey: string; delta: number }): ReputationDelta {
  const content: ReputationDeltaContent = {
    targetPubkey: opts.targetPubkey,
    delta: opts.delta,
  }

  return {
    kind: 10802,
    pubkey: opts.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', opts.targetPubkey]],
    content: JSON.stringify(content),
    sig: '',
  }
}
