import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeypair } from '../identity/keys.js'
import { buildAnnouncement } from '../protocol/announcement.js'
import { buildRequestAnnouncement } from '../protocol/request.js'
import { buildObservedAddressEvent, buildRouteAnnouncement, parseObservedAddressEvent, signRouteAnnouncement } from '../discovery/reachability.js'
import { signAnnouncement } from '../identity/signing.js'
import { signEvent } from '../identity/signing.js'
import { SqliteConnection } from '../sqlite/sqlite-connection.js'
import { NOSTR_KIND_ROWS } from './kinds.js'
import { NostrSqliteStore } from './sqlite-store.js'

let tmpRoot = ''

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'qdht-nostr-sqlite-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('NostrSqliteStore', () => {
  it('persists events across reopen', () => {
    const dbPath = join(tmpRoot, 'qdht.sqlite')
    const store = new NostrSqliteStore(dbPath)
    const keypair = generateKeypair()
    const announcement = buildAnnouncement({
      pubkey: keypair.pubkey,
      qkey: 'q1',
      hash: 'h'.repeat(64),
      sizeBytes: 100,
      pieces: 1,
      pieceSize: 100,
      ttl: 3600,
    })
    const signed = signAnnouncement(announcement, keypair.privkey)

    store.upsert(signed)
    expect(store.loadAll()).toHaveLength(1)
    const db = new SqliteConnection(dbPath)
    const tagRows = db.prepare('SELECT COUNT(*) AS count FROM event_tags').get() as { count: number }
    const tagKeyRows = db.prepare('SELECT COUNT(*) AS count FROM tag_keys').get() as { count: number }
    const identityRows = db.prepare('SELECT COUNT(*) AS count FROM identities').get() as { count: number }
    const kindRows = db.prepare('SELECT COUNT(*) AS count FROM kinds').get() as { count: number }
    const tableInfo = db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>
    db.close()
    expect(tagRows.count).toBeGreaterThan(0)
    expect(tagKeyRows.count).toBeGreaterThan(0)
    expect(identityRows.count).toBe(1)
    expect(kindRows.count).toBe(NOSTR_KIND_ROWS.length)
    expect(tableInfo.some((row) => row.name === 'identity_id')).toBe(true)
    expect(tableInfo.some((row) => row.name === 'kind_id')).toBe(true)
    expect(tableInfo.some((row) => row.name === 'pubkey')).toBe(false)
    expect(tableInfo.some((row) => row.name === 'content')).toBe(true)
    store.close()

    const reopened = new NostrSqliteStore(dbPath)
    const loaded = reopened.loadAll()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ kind: 10800, pubkey: keypair.pubkey })
    reopened.close()
  })

  it('normalizes secondary identity references into a separate table', () => {
    const dbPath = join(tmpRoot, 'qdht.sqlite')
    const store = new NostrSqliteStore(dbPath)
    const subject = generateKeypair()
    const observer = generateKeypair()
    const publisher = generateKeypair()

    const observed = buildObservedAddressEvent({
      subjectIdentity: subject.pubkey,
      observerIdentity: observer.pubkey,
      observedIp: '203.0.113.44',
      observedPort: 51820,
      transport: 'quic',
      observedAt: 1710000000,
      confidence: 0.9,
      dialbackSuccess: true,
    }, observer.privkey)
    store.upsert(observed)

    const route = buildRouteAnnouncement(subject.pubkey, [
      parseObservedAddressEvent(observed)!,
    ])
    store.upsert(signRouteAnnouncement(route, subject.privkey))

    const request = buildRequestAnnouncement({
      pubkey: publisher.pubkey,
      type: 'content',
      query: 'guide.pdf',
      limit: 10,
      ttl: 300,
      publisher: publisher.pubkey,
    })
    store.upsert(signEvent(request, publisher.privkey))

    const db = new SqliteConnection(dbPath)
    const refs = db.prepare('SELECT role FROM event_identity_refs ORDER BY role ASC').all() as Array<{ role: string }>
    const identityRows = db.prepare('SELECT COUNT(*) AS count FROM identities').get() as { count: number }
    db.close()

    expect(refs.map((ref) => ref.role)).toEqual(['observer', 'publisher', 'route_identity', 'subject'])
    expect(identityRows.count).toBe(3)
    store.close()
  })

  it('can query events by created_at', () => {
    const store = new NostrSqliteStore(join(tmpRoot, 'qdht.sqlite'))
    store.upsert({
      kind: 10800,
      pubkey: 'a'.repeat(64),
      created_at: 10,
      tags: [],
      content: '',
      sig: '',
      id: 'event-a',
    })
    store.upsert({
      kind: 10801,
      pubkey: 'a'.repeat(64),
      created_at: 20,
      tags: [],
      content: '',
      sig: '',
      id: 'event-b',
    })

    expect(store.loadSince(15)).toHaveLength(1)
    expect(store.loadSince(0)).toHaveLength(2)
    const db = new SqliteConnection(join(tmpRoot, 'qdht.sqlite'))
    const identityRows = db.prepare('SELECT COUNT(*) AS count FROM identities').get() as { count: number }
    db.close()
    expect(identityRows.count).toBe(1)
    store.close()
  })
})
