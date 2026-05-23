import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteConnection } from './sqlite-connection.js'

let tmpRoot = ''

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'qdht-sqlite-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('SqliteConnection', () => {
  it('executes pragmas, statements, and queries', () => {
    const db = new SqliteConnection(join(tmpRoot, 'qdht.sqlite'))
    db.exec('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, value TEXT NOT NULL);')
    const insert = db.prepare('INSERT OR REPLACE INTO items (id, value) VALUES (?, ?)')
    const select = db.prepare('SELECT id, value FROM items WHERE id = ? LIMIT 1')

    insert.run('a', 'alpha')
    expect(select.get('a')).toMatchObject({ id: 'a', value: 'alpha' })

    db.close()
  })
})
