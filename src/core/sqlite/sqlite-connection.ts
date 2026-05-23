import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase
}

export interface SqliteStatement {
  run(...args: unknown[]): unknown
  get(...args: unknown[]): unknown
  all(...args: unknown[]): unknown[]
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

export interface SqliteConnectionOptions {
  pragmas?: string[]
}

const DEFAULT_PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA busy_timeout = 5000',
  'PRAGMA foreign_keys = ON',
]

export class SqliteConnection {
  private readonly db: SqliteDatabase

  constructor(dbPath: string, options: SqliteConnectionOptions = {}) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.execPragmas(options.pragmas ?? DEFAULT_PRAGMAS)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): SqliteStatement {
    return this.db.prepare(sql)
  }

  close(): void {
    this.db.close()
  }

  private execPragmas(pragmas: string[]): void {
    if (pragmas.length === 0) {
      return
    }

    this.db.exec(pragmas.map((pragma) => `${pragma.trim().replace(/;$/, '')};`).join('\n'))
  }
}
