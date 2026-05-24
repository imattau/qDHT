import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { SqliteConnection, type SqliteStatement } from '../sqlite/sqlite-connection.js'
import type { StoredNostrEvent, NostrEventRepository } from '../storage/event-repository.js'
import { NOSTR_KIND_ROWS } from './kinds.js'

interface EventRow {
  event_key: string
  kind_id: number
  pubkey: string
  created_at: number
  content: string
  sig: string
  row_id: number
}

interface EventTagRow {
  event_key: string
  tag_key_id: number
  tag_index: number
  value_index: number
  tag_value: string
}

interface TagKeyRow {
  tag_key_id: number
  name: string
}

interface EventIdentityRefRow {
  event_key: string
  role: string
  identity_id: number
}

function eventKey(event: StoredNostrEvent): string {
  if (typeof event.id === 'string' && event.id.length > 0) {
    return event.id
  }

  return bytesToHex(sha256(utf8ToBytes(JSON.stringify({
    kind: event.kind,
    pubkey: event.pubkey,
    created_at: event.created_at,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  }))))
}

export class NostrSqliteStore implements NostrEventRepository {
  private readonly db: SqliteConnection
  private readonly ensureKindStmt
  private readonly ensureIdentityStmt
  private readonly getIdentityIdStmt
  private readonly ensureTagKeyStmt
  private readonly getTagKeyIdStmt
  private readonly insertStmt
  private readonly deleteTagsStmt
  private readonly deleteIdentityRefsStmt
  private readonly insertIdentityRefStmt
  private readonly insertTagStmt
  private readonly loadAllStmt
  private readonly loadSinceStmt
  private closed = false

  constructor(private readonly dbPath: string) {
    this.db = new SqliteConnection(dbPath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kinds (
        kind_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        searchable INTEGER NOT NULL,
        description TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS identities (
        identity_id INTEGER PRIMARY KEY AUTOINCREMENT,
        pubkey TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS events (
        event_key TEXT PRIMARY KEY,
        identity_id INTEGER NOT NULL,
        kind_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        content TEXT NOT NULL,
        sig TEXT NOT NULL,
        FOREIGN KEY (kind_id) REFERENCES kinds(kind_id) ON DELETE RESTRICT,
        FOREIGN KEY (identity_id) REFERENCES identities(identity_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS tag_keys (
        tag_key_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS event_tags (
        event_key TEXT NOT NULL,
        tag_key_id INTEGER NOT NULL,
        tag_index INTEGER NOT NULL,
        value_index INTEGER NOT NULL,
        tag_value TEXT NOT NULL,
        PRIMARY KEY (event_key, tag_key_id, tag_index, value_index),
        FOREIGN KEY (event_key) REFERENCES events(event_key) ON DELETE CASCADE,
        FOREIGN KEY (tag_key_id) REFERENCES tag_keys(tag_key_id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS event_identity_refs (
        event_key TEXT NOT NULL,
        role TEXT NOT NULL,
        identity_id INTEGER NOT NULL,
        PRIMARY KEY (event_key, role),
        FOREIGN KEY (event_key) REFERENCES events(event_key) ON DELETE CASCADE,
        FOREIGN KEY (identity_id) REFERENCES identities(identity_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_identities_pubkey ON identities(pubkey);
      CREATE INDEX IF NOT EXISTS idx_events_identity_created_at ON events(identity_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_events_kind_created_at ON events(kind_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
      CREATE INDEX IF NOT EXISTS idx_tag_keys_name ON tag_keys(name);
      CREATE INDEX IF NOT EXISTS idx_event_tags_event_key ON event_tags(event_key);
      CREATE INDEX IF NOT EXISTS idx_event_tags_tag_key_id ON event_tags(tag_key_id);
      CREATE INDEX IF NOT EXISTS idx_event_tags_value ON event_tags(tag_value);
      CREATE INDEX IF NOT EXISTS idx_event_identity_refs_identity ON event_identity_refs(identity_id);
      CREATE INDEX IF NOT EXISTS idx_event_identity_refs_role ON event_identity_refs(role);
    `)

    this.ensureKindStmt = this.db.prepare(`
      INSERT OR IGNORE INTO kinds (kind_id, name, category, searchable, description)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const row of NOSTR_KIND_ROWS) {
      this.ensureKindStmt.run(row.kind_id, row.name, row.category, row.searchable, row.description)
    }

    this.ensureIdentityStmt = this.db.prepare(`
      INSERT OR IGNORE INTO identities (pubkey)
      VALUES (?)
    `)
    this.getIdentityIdStmt = this.db.prepare(`
      SELECT identity_id
      FROM identities
      WHERE pubkey = ?
      LIMIT 1
    `)
    this.ensureTagKeyStmt = this.db.prepare(`
      INSERT OR IGNORE INTO tag_keys (name)
      VALUES (?)
    `)
    this.getTagKeyIdStmt = this.db.prepare(`
      SELECT tag_key_id
      FROM tag_keys
      WHERE name = ?
      LIMIT 1
    `)
    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO events (event_key, identity_id, kind_id, created_at, content, sig)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    this.deleteTagsStmt = this.db.prepare(`
      DELETE FROM event_tags
      WHERE event_key = ?
    `)
    this.deleteIdentityRefsStmt = this.db.prepare(`
      DELETE FROM event_identity_refs
      WHERE event_key = ?
    `)
    this.insertIdentityRefStmt = this.db.prepare(`
      INSERT OR REPLACE INTO event_identity_refs (event_key, role, identity_id)
      VALUES (?, ?, ?)
    `)
    this.insertTagStmt = this.db.prepare(`
      INSERT OR REPLACE INTO event_tags (event_key, tag_key_id, tag_index, value_index, tag_value)
      VALUES (?, ?, ?, ?, ?)
    `)
    this.loadAllStmt = this.db.prepare(`
      SELECT e.event_key, i.pubkey, e.kind_id, e.created_at, e.content, e.sig, e.rowid AS row_id
      FROM events e
      JOIN identities i ON i.identity_id = e.identity_id
      ORDER BY e.created_at ASC, e.rowid ASC
    `)
    this.loadSinceStmt = this.db.prepare(`
      SELECT e.event_key, i.pubkey, e.kind_id, e.created_at, e.content, e.sig, e.rowid AS row_id
      FROM events e
      JOIN identities i ON i.identity_id = e.identity_id
      WHERE e.created_at >= ?
      ORDER BY e.created_at ASC, e.rowid ASC
    `)
  }

  upsert(event: StoredNostrEvent): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.ensureIdentityStmt.run(event.pubkey)
      const identityRow = this.getIdentityIdStmt.get(event.pubkey) as { identity_id?: number } | undefined
      if (!identityRow || typeof identityRow.identity_id !== 'number') {
        throw new Error(`failed to resolve identity id for ${event.pubkey}`)
      }
      const identityId = identityRow.identity_id
      this.insertStmt.run(
        eventKey(event),
        identityId,
        event.kind,
        event.created_at,
        event.content,
        event.sig,
      )
      const eventKeyValue = eventKey(event)
      this.deleteTagsStmt.run(eventKeyValue)
      this.deleteIdentityRefsStmt.run(eventKeyValue)
      for (const ref of this.extractIdentityRefs(event)) {
        this.ensureIdentityStmt.run(ref.pubkey)
        const refIdentityRow = this.getIdentityIdStmt.get(ref.pubkey) as { identity_id?: number } | undefined
        if (!refIdentityRow || typeof refIdentityRow.identity_id !== 'number') {
          continue
        }
        this.insertIdentityRefStmt.run(eventKeyValue, ref.role, refIdentityRow.identity_id)
      }
      for (let tagIndex = 0; tagIndex < event.tags.length; tagIndex++) {
        const tag = event.tags[tagIndex]
        if (!Array.isArray(tag)) {
          continue
        }
        const tagName = tag[0]
        if (typeof tagName !== 'string' || tagName.length === 0) {
          continue
        }
        this.ensureTagKeyStmt.run(tagName)
        const tagKeyRow = this.getTagKeyIdStmt.get(tagName) as { tag_key_id?: number } | undefined
        if (!tagKeyRow || typeof tagKeyRow.tag_key_id !== 'number') {
          continue
        }
        for (let valueIndex = 0; valueIndex < tag.length; valueIndex++) {
          this.insertTagStmt.run(eventKeyValue, tagKeyRow.tag_key_id, tagIndex, valueIndex, tag[valueIndex] ?? '')
        }
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  loadAll(): StoredNostrEvent[] {
    return this.readRows(this.loadAllStmt.all() as unknown as EventRow[])
  }

  loadSince(createdAt: number): StoredNostrEvent[] {
    return this.readRows(this.loadSinceStmt.all(createdAt) as unknown as EventRow[])
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.db.close()
  }

  private readRows(rows: EventRow[]): StoredNostrEvent[] {
    const events: StoredNostrEvent[] = []
    const wantedKeys = new Set(rows.map((row) => row.event_key))
    const tagsByEvent = new Map<string, string[][]>()
    for (const row of this.db.prepare(`
      SELECT event_key, tag_key_id, tag_index, value_index, tag_value
      FROM event_tags
      ORDER BY event_key ASC, tag_key_id ASC, tag_index ASC, value_index ASC
    `).all() as EventTagRow[]) {
      if (!wantedKeys.has(row.event_key)) {
        continue
      }
      const tags = tagsByEvent.get(row.event_key) ?? []
      if (!tags[row.tag_index]) {
        tags[row.tag_index] = []
      }
      tags[row.tag_index]![row.value_index] = row.tag_value
      tagsByEvent.set(row.event_key, tags)
    }

    for (const row of rows) {
      const tags = tagsByEvent.get(row.event_key) ?? []
      events.push({
        id: row.event_key,
        kind: row.kind_id,
        pubkey: row.pubkey,
        created_at: row.created_at,
        tags: tags.filter((tag): tag is string[] => Array.isArray(tag)).map((tag) => tag.filter((value): value is string => typeof value === 'string')),
        content: row.content,
        sig: row.sig,
      })
    }
    return events
  }

  private extractIdentityRefs(event: StoredNostrEvent): Array<{ role: string; pubkey: string }> {
    const refs: Array<{ role: string; pubkey: string }> = []

    if (event.kind === 30800) {
      const payload = this.safeParse(event.content) as { subjectIdentity?: unknown; observerIdentity?: unknown } | null
      if (payload) {
        if (typeof payload.subjectIdentity === 'string') {
          refs.push({ role: 'subject', pubkey: payload.subjectIdentity })
        }
        if (typeof payload.observerIdentity === 'string') {
          refs.push({ role: 'observer', pubkey: payload.observerIdentity })
        }
      }
    }

    if (event.kind === 30801) {
      const payload = this.safeParse(event.content) as { identity?: unknown } | null
      if (payload && typeof payload.identity === 'string') {
        refs.push({ role: 'route_identity', pubkey: payload.identity })
      }
    }

    if (event.kind === 10804) {
      const payload = this.safeParse(event.content) as { publisher?: unknown } | null
      if (payload && typeof payload.publisher === 'string') {
        refs.push({ role: 'publisher', pubkey: payload.publisher })
      }
    }

    return refs
  }

  private safeParse(raw: string): unknown | null {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
}
