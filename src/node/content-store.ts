import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SqliteConnection, type SqliteStatement } from '../core/sqlite/sqlite-connection.js'
import type { ContentIndexEntry, ContentIndexRepository, ContentLocation, PutMeta } from '../core/storage/content-repository.js'

const PIECE_SIZE = 512 * 1024

type Index = Record<string, ContentIndexEntry>

interface ContentRow {
  qkey: string
  hash: string
  total_pieces: number
  piece_size: number
  size_bytes: number
  name: string | null
  mime: string | null
  created_at: string
  ttl: number
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function splitPieces(data: Buffer): Buffer[] {
  const pieces: Buffer[] = []
  for (let offset = 0; offset < data.length; offset += PIECE_SIZE) {
    pieces.push(data.subarray(offset, offset + PIECE_SIZE))
  }
  return pieces.length > 0 ? pieces : [Buffer.alloc(0)]
}

function normalizeEntry(row: ContentRow): ContentIndexEntry {
  return {
    hash: row.hash,
    totalPieces: row.total_pieces,
    pieceSize: row.piece_size,
    sizeBytes: row.size_bytes,
    name: row.name ?? undefined,
    mime: row.mime ?? undefined,
    createdAt: row.created_at,
    pieceHashes: [],
    ttl: row.ttl,
  }
}

export class ContentStore implements ContentIndexRepository {
  private readonly db: SqliteConnection
  private readonly upsertStmt: SqliteStatement
  private readonly getByQkeyStmt: SqliteStatement
  private readonly getByHashStmt: SqliteStatement
  private readonly loadAllStmt: SqliteStatement
  private readonly deletePieceHashesStmt: SqliteStatement
  private readonly insertPieceHashStmt: SqliteStatement
  private closed = false

  constructor(private dataDir: string) {
    mkdirSync(this.dataDir, { recursive: true })
    const dbPath = join(this.dataDir, 'qdht.sqlite')
    this.db = new SqliteConnection(dbPath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS content_index (
        qkey TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        total_pieces INTEGER NOT NULL,
        piece_size INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        name TEXT,
        mime TEXT,
        created_at TEXT NOT NULL,
        ttl INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_piece_hashes (
        qkey TEXT NOT NULL,
        piece_index INTEGER NOT NULL,
        piece_hash TEXT NOT NULL,
        PRIMARY KEY (qkey, piece_index),
        FOREIGN KEY (qkey) REFERENCES content_index(qkey) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_content_index_hash ON content_index(hash);
      CREATE INDEX IF NOT EXISTS idx_content_index_created_at ON content_index(created_at);
      CREATE INDEX IF NOT EXISTS idx_content_piece_hashes_qkey ON content_piece_hashes(qkey);
    `)

    this.upsertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO content_index (
        qkey, hash, total_pieces, piece_size, size_bytes, name, mime, created_at, ttl
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.getByQkeyStmt = this.db.prepare(`
      SELECT qkey, hash, total_pieces, piece_size, size_bytes, name, mime, created_at, ttl
      FROM content_index
      WHERE qkey = ?
      LIMIT 1
    `)
    this.getByHashStmt = this.db.prepare(`
      SELECT qkey, hash, total_pieces, piece_size, size_bytes, name, mime, created_at, ttl
      FROM content_index
      WHERE hash = ?
      LIMIT 1
    `)
    this.loadAllStmt = this.db.prepare(`
      SELECT qkey, hash, total_pieces, piece_size, size_bytes, name, mime, created_at, ttl
      FROM content_index
      ORDER BY created_at ASC, qkey ASC
    `)
    this.deletePieceHashesStmt = this.db.prepare(`
      DELETE FROM content_piece_hashes
      WHERE qkey = ?
    `)
    this.insertPieceHashStmt = this.db.prepare(`
      INSERT INTO content_piece_hashes (qkey, piece_index, piece_hash)
      VALUES (?, ?, ?)
    `)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.db.close()
  }

  async put(data: Buffer, meta: PutMeta): Promise<ContentLocation> {
    const hash = sha256(data)
    const pieceDir = join(this.dataDir, hash)
    mkdirSync(pieceDir, { recursive: true })

    const pieces = splitPieces(data)
    const pieceHashes = pieces.map((piece) => sha256(piece))

    for (let index = 0; index < pieces.length; index++) {
      writeFileSync(join(pieceDir, `${index}.bin`), pieces[index]!)
    }

    const createdAt = new Date().toISOString()
    this.upsertStmt.run(
      hash,
      hash,
      pieces.length,
      PIECE_SIZE,
      data.length,
      meta.name ?? null,
      meta.mime ?? null,
      createdAt,
      meta.ttl,
    )
    this.deletePieceHashesStmt.run(hash)
    for (let index = 0; index < pieceHashes.length; index++) {
      this.insertPieceHashStmt.run(hash, index, pieceHashes[index]!)
    }

    return {
      qkey: hash,
      hash,
      totalPieces: pieces.length,
      pieceSize: PIECE_SIZE,
      sizeBytes: data.length,
      name: meta.name,
      mime: meta.mime,
      createdAt,
    }
  }

  async hasPiece(hash: string, index: number): Promise<boolean> {
    const entry = this.getEntryByHash(hash)
    if (!entry || index < 0 || index >= entry.totalPieces) {
      return false
    }

    try {
      statSync(join(this.dataDir, hash, `${index}.bin`))
      return true
    } catch {
      return false
    }
  }

  async getPiece(hash: string, index: number): Promise<Buffer | null> {
    const entry = this.getEntryByHash(hash)
    if (!entry || index < 0 || index >= entry.totalPieces) {
      return null
    }

    try {
      const piece = readFileSync(join(this.dataDir, hash, `${index}.bin`))
      if (sha256(piece) !== entry.pieceHashes[index]) {
        return null
      }
      return piece
    } catch {
      return null
    }
  }

  async getIndex(): Promise<Index> {
    const rows = this.loadAllStmt.all() as unknown as ContentRow[]
    const index: Index = {}
    for (const row of rows) {
      index[row.qkey] = {
        ...normalizeEntry(row),
        pieceHashes: this.loadPieceHashes(row.qkey),
      }
    }
    return index
  }

  private getEntryByHash(hash: string): ContentIndexEntry | null {
    const row = (this.getByQkeyStmt.get(hash) as ContentRow | undefined)
      ?? (this.getByHashStmt.get(hash) as ContentRow | undefined)
    if (!row) {
      return null
    }
    return this.loadEntry(row.qkey, row)
  }

  private loadPieceHashes(qkey: string): string[] {
    const rows = this.db.prepare(`
      SELECT piece_hash
      FROM content_piece_hashes
      WHERE qkey = ?
      ORDER BY piece_index ASC
    `).all(qkey) as Array<{ piece_hash: string }>
    return rows.map((row) => row.piece_hash)
  }

  private loadEntry(qkey: string, row: ContentRow): ContentIndexEntry {
    return {
      ...normalizeEntry(row),
      pieceHashes: this.loadPieceHashes(qkey),
    }
  }
}
