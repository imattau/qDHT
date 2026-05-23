import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteConnection } from '../core/sqlite/sqlite-connection.js'
import { ContentStore } from './content-store.js'

let tmpDir = ''
let store: ContentStore

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qdht-content-'))
  store = new ContentStore(tmpDir)
})

afterEach(async () => {
  store.close()
  await rm(tmpDir, { recursive: true, force: true })
})

describe('ContentStore.put', () => {
  it('returns a ContentLocation with hash and piece count', async () => {
    const data = Buffer.from('hello world')
    const loc = await store.put(data, { name: 'hello.txt', mime: 'text/plain', ttl: 3600 })
    expect(typeof loc.hash).toBe('string')
    expect(loc.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(loc.totalPieces).toBeGreaterThan(0)
    expect(loc.pieceSize).toBeGreaterThan(0)
    expect(loc.qkey).toMatch(/^[0-9a-f]/)
  })

  it('splits large data into multiple pieces', async () => {
    const data = Buffer.alloc(512 * 1024 + 1, 0x42)
    const loc = await store.put(data, { name: 'big.bin', ttl: 3600 })
    expect(loc.totalPieces).toBeGreaterThanOrEqual(2)
  })
})

describe('ContentStore.hasPiece', () => {
  it('returns true for stored pieces', async () => {
    const data = Buffer.from('test data for piece check')
    const loc = await store.put(data, { name: 'test.bin', ttl: 3600 })
    expect(await store.hasPiece(loc.hash, 0)).toBe(true)
  })

  it('returns false for missing pieces', async () => {
    expect(await store.hasPiece('a'.repeat(64), 0)).toBe(false)
  })
})

describe('ContentStore.getPiece', () => {
  it('returns the piece bytes for a stored piece', async () => {
    const data = Buffer.from('retrieve me')
    const loc = await store.put(data, { name: 'get.txt', ttl: 3600 })
    const piece = await store.getPiece(loc.hash, 0)
    expect(piece).toBeInstanceOf(Buffer)
    expect(piece!.length).toBeGreaterThan(0)
  })

  it('returns null for a missing piece', async () => {
    const result = await store.getPiece('b'.repeat(64), 0)
    expect(result).toBeNull()
  })

  it('round-trips data across put + getPiece reassembly', async () => {
    const original = Buffer.from('round trip test content - should survive the journey intact')
    const loc = await store.put(original, { name: 'rt.txt', ttl: 3600 })
    const chunks: Buffer[] = []
    for (let index = 0; index < loc.totalPieces; index++) {
      const piece = await store.getPiece(loc.hash, index)
      expect(piece).not.toBeNull()
      chunks.push(piece!)
    }
    expect(Buffer.concat(chunks)).toEqual(original)
  })
})

describe('ContentStore index', () => {
  it('persists index across instances', async () => {
    const data = Buffer.from('persist test')
    const loc = await store.put(data, { name: 'persist.txt', ttl: 3600 })
    const db = new SqliteConnection(join(tmpDir, 'qdht.sqlite'))
    const pieceRows = db.prepare('SELECT COUNT(*) AS count FROM content_piece_hashes WHERE qkey = ?').get(loc.qkey) as { count: number }
    db.close()
    const store2 = new ContentStore(tmpDir)
    expect(await store2.hasPiece(loc.hash, 0)).toBe(true)
    expect(pieceRows.count).toBe(loc.totalPieces)
    expect(existsSync(join(tmpDir, 'qdht.sqlite'))).toBe(true)
    expect(existsSync(join(tmpDir, 'index.json'))).toBe(false)
    store2.close()
  })
})
