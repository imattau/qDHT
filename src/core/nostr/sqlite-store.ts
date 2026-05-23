import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { NostrEvent } from './event.js'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase
}

interface SqliteStatement {
  run(...args: unknown[]): unknown
  all(...args: unknown[]): unknown[]
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

export interface StoredNostrEvent extends NostrEvent {
  id?: string
}

interface EventRow {
  event_key: string
  event_json: string
}

function eventKey(event: StoredNostrEvent): string {
  if (typeof event.id === 'string' && event.id.length > 0) {
    return event.id
  }

  return createHash('sha256')
    .update(JSON.stringify({
      kind: event.kind,
      pubkey: event.pubkey,
      created_at: event.created_at,
      tags: event.tags,
      content: event.content,
      sig: event.sig,
    }))
    .digest('hex')
}

export class NostrSqliteStore {
  private readonly db: SqliteDatabase
  private readonly insertStmt
  private readonly loadAllStmt
  private readonly loadSinceStmt
  private closed = false

  constructor(private readonly dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS events (
        event_key TEXT PRIMARY KEY,
        kind INTEGER NOT NULL,
        pubkey TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_kind_created_at ON events(kind, created_at);
      CREATE INDEX IF NOT EXISTS idx_events_pubkey_created_at ON events(pubkey, created_at);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
    `)

    this.insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO events (event_key, kind, pubkey, created_at, event_json)
      VALUES (?, ?, ?, ?, ?)
    `)
    this.loadAllStmt = this.db.prepare(`
      SELECT event_key, event_json
      FROM events
      ORDER BY created_at ASC, rowid ASC
    `)
    this.loadSinceStmt = this.db.prepare(`
      SELECT event_key, event_json
      FROM events
      WHERE created_at >= ?
      ORDER BY created_at ASC, rowid ASC
    `)
  }

  upsert(event: StoredNostrEvent): void {
    this.insertStmt.run(
      eventKey(event),
      event.kind,
      event.pubkey,
      event.created_at,
      JSON.stringify(event),
    )
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
    for (const row of rows) {
      try {
        events.push(JSON.parse(row.event_json) as StoredNostrEvent)
      } catch {
        continue
      }
    }
    return events
  }
}
