import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeypair } from '../identity/keys.js'
import { buildAnnouncement } from '../protocol/announcement.js'
import { signAnnouncement } from '../identity/signing.js'
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
    const dbPath = join(tmpRoot, 'nostr.sqlite')
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
    store.close()

    const reopened = new NostrSqliteStore(dbPath)
    const loaded = reopened.loadAll()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ kind: 10800, pubkey: keypair.pubkey })
    reopened.close()
  })

  it('can query events by created_at', () => {
    const store = new NostrSqliteStore(join(tmpRoot, 'nostr.sqlite'))
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
      pubkey: 'b'.repeat(64),
      created_at: 20,
      tags: [],
      content: '',
      sig: '',
      id: 'event-b',
    })

    expect(store.loadSince(15)).toHaveLength(1)
    expect(store.loadSince(0)).toHaveLength(2)
    store.close()
  })
})
