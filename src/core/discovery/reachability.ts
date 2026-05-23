import { nip19 } from 'nostr-tools'
import { type SignedNostrEvent } from '../nostr/event.js'
import { type StoredNostrEvent, NostrSqliteStore } from '../nostr/sqlite-store.js'
import { signEvent, verifyEvent } from '../identity/signing.js'

export const REACHABILITY_KIND = {
  OBSERVED_ADDRESS: 30800,
  ROUTE_ANNOUNCEMENT: 30801,
} as const

export type ReachabilityTransport = 'quic' | 'udp' | 'tcp' | 'ws' | 'wss'
export type EndpointTransport = ReachabilityTransport | 'relay'

export interface ObservedAddressReport {
  subjectIdentity: string
  observerIdentity: string
  observedIp: string
  observedPort: number
  transport: ReachabilityTransport
  observedAt: number
  confidence: number
  dialbackSuccess: boolean
}

export interface RouteEndpoint {
  transport: EndpointTransport
  address: string
  port?: number
  source: 'peer-observed' | 'dialback-confirmed' | 'fallback'
  confidence: number
}

export interface RouteAnnouncement {
  identity: string
  sequence: number
  endpoints: RouteEndpoint[]
  nat: {
    typeEstimate: 'stable-public' | 'port-changing' | 'symmetric-nat' | 'cgnat' | 'unknown'
  }
  observedAt: number
}

export interface ResolvedRoute {
  identity: string
  reachable: boolean
  bestEndpoint: RouteEndpoint | null
  fallback: RouteEndpoint | null
  endpoints: RouteEndpoint[]
  nat: RouteAnnouncement['nat']
  sequence: number
  updatedAt: number
}

export interface ResolvedPeerTarget {
  identity: string
  transport: EndpointTransport
  url: string
  confidence: number
  source: 'direct' | 'route'
}

export interface RouteStore {
  loadAll(): StoredNostrEvent[]
}

export interface PublishObservedAddressInput {
  subjectIdentity: string
  observerIdentity: string
  observedIp: string
  observedPort: number
  transport: ReachabilityTransport
  observedAt: number
  confidence: number
  dialbackSuccess: boolean
}

export function normalizeIdentityRef(input: string): { identity: string; relays: string[] } | null {
  const trimmed = input.trim()
  const nostrUri = trimmed.startsWith('nostr://') ? trimmed.slice('nostr://'.length) : trimmed.startsWith('nostr:') ? trimmed.slice('nostr:'.length) : trimmed

  if (/^[0-9a-f]{64}$/i.test(nostrUri)) {
    return { identity: nostrUri.toLowerCase(), relays: [] }
  }

  try {
    const decoded = nip19.decode(nostrUri)
    if (decoded.type === 'npub' && typeof decoded.data === 'string') {
      return { identity: decoded.data, relays: [] }
    }
    if (decoded.type === 'nprofile' && decoded.data && typeof decoded.data === 'object') {
      const data = decoded.data as { pubkey?: unknown; relays?: unknown }
      if (typeof data.pubkey === 'string') {
        return {
          identity: data.pubkey,
          relays: Array.isArray(data.relays) ? data.relays.filter((relay): relay is string => typeof relay === 'string') : [],
        }
      }
    }
  } catch {
    return null
  }

  return null
}

export function isDirectPeerRef(input: string): boolean {
  return /^(ws|wss|quic):\/\//i.test(input)
}

function normalizeIdentity(identity: string): string {
  return identity.trim().toLowerCase()
}

function shortIdentity(identity: string): string {
  return normalizeIdentity(identity)
}

function estimateNatType(reports: ObservedAddressReport[]): RouteAnnouncement['nat']['typeEstimate'] {
  const byIp = new Map<string, Set<number>>()
  let successes = 0
  for (const report of reports) {
    if (!byIp.has(report.observedIp)) {
      byIp.set(report.observedIp, new Set<number>())
    }
    byIp.get(report.observedIp)?.add(report.observedPort)
    if (report.dialbackSuccess) {
      successes += 1
    }
  }

  if (reports.length === 0) {
    return 'unknown'
  }
  if (successes === 0) {
    return 'symmetric-nat'
  }
  if (byIp.size > 1) {
    return successes >= 2 ? 'cgnat' : 'unknown'
  }

  const ports = [...byIp.values()][0] ?? new Set<number>()
  if (ports.size > 1) {
    return 'port-changing'
  }
  return 'stable-public'
}

export function buildObservedAddressEvent(
  report: PublishObservedAddressInput,
  privkey: string,
): SignedNostrEvent {
  return signEvent(
    {
      kind: REACHABILITY_KIND.OBSERVED_ADDRESS,
      pubkey: report.observerIdentity,
      created_at: report.observedAt,
      tags: [
        ['subject', report.subjectIdentity],
        ['transport', report.transport],
        ['endpoint', `${report.observedIp}:${report.observedPort}`],
        ['dialback', report.dialbackSuccess ? 'success' : 'failure'],
        ['confidence', report.confidence.toFixed(2)],
      ],
      content: JSON.stringify({
        subjectIdentity: report.subjectIdentity,
        observerIdentity: report.observerIdentity,
        observedIp: report.observedIp,
        observedPort: report.observedPort,
        transport: report.transport,
        observedAt: report.observedAt,
        confidence: report.confidence,
        dialbackSuccess: report.dialbackSuccess,
      }),
      sig: '',
    },
    privkey,
  )
}

export function parseObservedAddressEvent(event: SignedNostrEvent): ObservedAddressReport | null {
  if (event.kind !== REACHABILITY_KIND.OBSERVED_ADDRESS) {
    return null
  }
  if (!verifyEvent(event)) {
    return null
  }

  try {
    const payload = JSON.parse(event.content) as Partial<ObservedAddressReport>
    if (
      typeof payload.subjectIdentity === 'string' &&
      typeof payload.observerIdentity === 'string' &&
      typeof payload.observedIp === 'string' &&
      typeof payload.observedPort === 'number' &&
      typeof payload.transport === 'string' &&
      typeof payload.observedAt === 'number' &&
      typeof payload.confidence === 'number' &&
      typeof payload.dialbackSuccess === 'boolean'
    ) {
      return payload as ObservedAddressReport
    }
  } catch {
    return null
  }
  return null
}

export function buildRouteAnnouncement(identity: string, reports: ObservedAddressReport[], sequence = 1): RouteAnnouncement {
  const normalizedIdentity = shortIdentity(identity)
  const aggregated = new Map<string, { report: ObservedAddressReport; score: number }>()

  for (const report of reports) {
    if (normalizeIdentity(report.subjectIdentity) !== normalizedIdentity) {
      continue
    }
    const key = `${report.transport}:${report.observedIp}:${report.observedPort}`
    const score = report.confidence + (report.dialbackSuccess ? 0.35 : -0.15)
    const current = aggregated.get(key)
    if (!current || score > current.score) {
      aggregated.set(key, { report, score })
    }
  }

  const endpoints: RouteEndpoint[] = [...aggregated.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map(({ report, score }) => ({
      transport: report.transport,
      address: report.observedIp,
      port: report.observedPort,
      source: report.dialbackSuccess ? 'dialback-confirmed' : 'peer-observed',
      confidence: Math.max(0, Math.min(1, score)),
    }) as RouteEndpoint)

  endpoints.push({
    transport: 'relay',
    address: 'wss://relay.example',
    source: 'fallback',
    confidence: 1.0,
  })

  return {
    identity: normalizedIdentity,
    sequence,
    endpoints,
    nat: {
      typeEstimate: estimateNatType(reports),
    },
    observedAt: Date.now(),
  }
}

export function signRouteAnnouncement(announcement: RouteAnnouncement, privkey: string): SignedNostrEvent {
  return signEvent(
    {
      kind: REACHABILITY_KIND.ROUTE_ANNOUNCEMENT,
      pubkey: announcement.identity,
      created_at: Math.floor(announcement.observedAt / 1000),
      tags: [
        ['identity', announcement.identity],
        ['seq', String(announcement.sequence)],
        ['nat', announcement.nat.typeEstimate],
      ],
      content: JSON.stringify(announcement),
      sig: '',
    },
    privkey,
  )
}

export function parseRouteAnnouncement(event: StoredNostrEvent): RouteAnnouncement | null {
  if (event.kind !== REACHABILITY_KIND.ROUTE_ANNOUNCEMENT) {
    return null
  }
  if (typeof event.pubkey !== 'string' || !verifyEvent(event as SignedNostrEvent)) {
    return null
  }

  try {
    const parsed = JSON.parse(event.content) as Partial<RouteAnnouncement>
    if (
      typeof parsed.identity === 'string' &&
      typeof parsed.sequence === 'number' &&
      Array.isArray(parsed.endpoints) &&
      parsed.endpoints.every(isRouteEndpoint) &&
      parsed.nat &&
      typeof parsed.nat.typeEstimate === 'string' &&
      typeof parsed.observedAt === 'number'
    ) {
      return {
        identity: normalizeIdentity(parsed.identity),
        sequence: parsed.sequence,
        endpoints: parsed.endpoints.map((endpoint) => ({
          ...endpoint,
          source: endpoint.source,
          transport: endpoint.transport,
          confidence: clamp01(endpoint.confidence),
        })),
        nat: {
          typeEstimate: parsed.nat.typeEstimate,
        },
        observedAt: parsed.observedAt,
      }
    }
  } catch {
    return null
  }
  return null
}

export function resolveRouteAnnouncement(identity: string, events: StoredNostrEvent[]): ResolvedRoute | null {
  const normalizedIdentity = normalizeIdentity(identity)
  let latest: RouteAnnouncement | null = null

  for (const event of events) {
    const route = parseRouteAnnouncement(event)
    if (!route || route.identity !== normalizedIdentity) {
      continue
    }
    if (!latest || route.sequence > latest.sequence || (route.sequence === latest.sequence && route.observedAt > latest.observedAt)) {
      latest = route
    }
  }

  if (!latest) {
    return null
  }

  const dialable = latest.endpoints.filter((endpoint) => endpoint.transport !== 'relay')
  const bestEndpoint = dialable.length > 0 ? [...dialable].sort((left, right) => right.confidence - left.confidence)[0] ?? null : null
  const fallback = latest.endpoints.find((endpoint) => endpoint.transport === 'relay') ?? null

  return {
    identity: normalizedIdentity,
    reachable: bestEndpoint !== null,
    bestEndpoint,
    fallback,
    endpoints: latest.endpoints,
    nat: latest.nat,
    sequence: latest.sequence,
    updatedAt: latest.observedAt,
  }
}

export function routeAnnouncementToDialTargets(route: ResolvedRoute): ResolvedPeerTarget[] {
  const targets: ResolvedPeerTarget[] = []
  for (const endpoint of route.endpoints) {
    if (endpoint.transport === 'relay') {
      targets.push({
        identity: route.identity,
        transport: endpoint.transport,
        url: endpoint.address,
        confidence: endpoint.confidence,
        source: 'route' as const,
      })
      continue
    }

    const url = endpoint.port !== undefined
      ? `${endpoint.transport}://${endpoint.address}:${endpoint.port}`
      : `${endpoint.transport}://${endpoint.address}`

    targets.push({
      identity: route.identity,
      transport: endpoint.transport,
      url,
      confidence: endpoint.confidence,
      source: 'route' as const,
    })
  }
  return targets
}

export class ReachabilityDirectory {
  private readonly store: NostrSqliteStore

  constructor(dbPath: string) {
    this.store = new NostrSqliteStore(dbPath)
  }

  close(): void {
    this.store.close()
  }

  resolve(identityRef: string): ResolvedRoute | null {
    const parsed = normalizeIdentityRef(identityRef)
    if (!parsed) {
      return null
    }
    return resolveRouteAnnouncement(parsed.identity, this.store.loadAll())
  }

  resolvePeerTargets(peerRef: string): ResolvedPeerTarget[] {
    if (isDirectPeerRef(peerRef)) {
      const transport = peerRef.startsWith('quic://')
        ? 'quic'
        : peerRef.startsWith('ws://')
          ? 'ws'
          : 'wss'
      return [{
        identity: peerRef,
        transport,
        url: peerRef,
        confidence: 1,
        source: 'direct',
      }]
    }

    const parsed = normalizeIdentityRef(peerRef)
    if (!parsed) {
      return []
    }

    const route = this.resolve(peerRef)
    if (!route) {
      return []
    }

    return routeAnnouncementToDialTargets(route)
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function isRouteEndpoint(value: unknown): value is RouteEndpoint {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<RouteEndpoint>
  return (
    typeof candidate.transport === 'string' &&
    typeof candidate.address === 'string' &&
    typeof candidate.source === 'string' &&
    typeof candidate.confidence === 'number'
  )
}
