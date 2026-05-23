import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { npubEncode } from 'nostr-tools/nip19'
import { generateKeypair } from '../identity/keys.js'
import { NostrSqliteStore } from '../nostr/sqlite-store.js'
import {
  buildObservedAddressEvent,
  buildRouteAnnouncement,
  parseObservedAddressEvent,
  ReachabilityDirectory,
  resolveRouteAnnouncement,
  signRouteAnnouncement,
} from './reachability.js'

let tmpRoot = ''

afterEach(async () => {
  if (!tmpRoot) {
    return
  }
  await rm(tmpRoot, { recursive: true, force: true })
  tmpRoot = ''
})

describe('reachability routing', () => {
  it('builds signed route announcements and resolves them from sqlite', async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'qdht-reachability-'))
    const dbPath = join(tmpRoot, 'nostr.sqlite')
    const store = new NostrSqliteStore(dbPath)

    const subject = generateKeypair()
    const observerA = generateKeypair()
    const observerB = generateKeypair()

    const reportA = buildObservedAddressEvent({
      subjectIdentity: subject.pubkey,
      observerIdentity: observerA.pubkey,
      observedIp: '203.0.113.44',
      observedPort: 51820,
      transport: 'quic',
      observedAt: 1710000000,
      confidence: 0.9,
      dialbackSuccess: true,
    }, observerA.privkey)

    const reportB = buildObservedAddressEvent({
      subjectIdentity: subject.pubkey,
      observerIdentity: observerB.pubkey,
      observedIp: '203.0.113.44',
      observedPort: 60433,
      transport: 'quic',
      observedAt: 1710000001,
      confidence: 0.7,
      dialbackSuccess: true,
    }, observerB.privkey)

    const parsedA = parseObservedAddressEvent(reportA)
    const parsedB = parseObservedAddressEvent(reportB)
    expect(parsedA).not.toBeNull()
    expect(parsedB).not.toBeNull()

    const route = buildRouteAnnouncement(subject.pubkey, [parsedA!, parsedB!])
    const signedRoute = signRouteAnnouncement(route, subject.privkey)
    store.upsert(signedRoute)

    const resolver = new ReachabilityDirectory(dbPath)
    const npub = npubEncode(subject.pubkey)
    const resolved = resolver.resolve(npub)
    const targets = resolver.resolvePeerTargets(`nostr://${npub}`)

    expect(resolved).not.toBeNull()
    expect(resolved?.bestEndpoint?.transport).toBe('quic')
    expect(resolved?.bestEndpoint?.address).toBe('203.0.113.44')
    expect(resolved?.fallback?.transport).toBe('relay')
    expect(targets[0]).toMatchObject({
      transport: 'quic',
      url: 'quic://203.0.113.44:51820',
      source: 'route',
    })
    expect(targets.some((target) => target.transport === 'relay')).toBe(true)

    resolver.close()
    store.close()
  })

  it('resolves direct transport urls without route records', () => {
    const tmp = join(tmpdir(), `qdht-reachability-${Date.now()}`)
    const resolver = new ReachabilityDirectory(join(tmp, 'nostr.sqlite'))
    expect(resolver.resolvePeerTargets('ws://127.0.0.1:1234')).toEqual([
      {
        identity: 'ws://127.0.0.1:1234',
        transport: 'ws',
        url: 'ws://127.0.0.1:1234',
        confidence: 1,
        source: 'direct',
      },
    ])
    resolver.close()
  })
})
