import { createHash } from 'node:crypto'
import type { ContentIndexEntry, ContentIndexRepository, ContentLocation, PutMeta } from './content-repository.js'
import type { NostrEventRepository, StoredNostrEvent } from './event-repository.js'
import type { NodeStorage } from './node-storage.js'

const PIECE_SIZE = 512 * 1024

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

class MemoryContentRepository implements ContentIndexRepository {
  private readonly index = new Map<string, ContentIndexEntry>()
  private readonly pieces = new Map<string, Buffer[]>()

  async put(data: Buffer, meta: PutMeta): Promise<ContentLocation> {
    const hash = sha256(data)
    const pieces = splitPieces(data)
    const pieceHashes = pieces.map((piece) => sha256(piece))
    const createdAt = new Date().toISOString()
    const entry: ContentIndexEntry = {
      hash,
      totalPieces: pieces.length,
      pieceSize: PIECE_SIZE,
      sizeBytes: data.length,
      name: meta.name,
      mime: meta.mime,
      createdAt,
      pieceHashes,
      ttl: meta.ttl,
    }

    this.index.set(hash, entry)
    this.pieces.set(hash, pieces)

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
    const pieces = this.pieces.get(hash)
    return Boolean(pieces && index >= 0 && index < pieces.length)
  }

  async getPiece(hash: string, index: number): Promise<Buffer | null> {
    const entry = this.index.get(hash)
    const pieces = this.pieces.get(hash)
    if (!entry || !pieces || index < 0 || index >= pieces.length) {
      return null
    }

    const piece = pieces[index]
    if (!piece) {
      return null
    }
    if (sha256(piece) !== entry.pieceHashes[index]) {
      return null
    }
    return Buffer.from(piece)
  }

  async getIndex(): Promise<Record<string, ContentIndexEntry>> {
    return Object.fromEntries(this.index.entries())
  }

  close(): void {}
}

class MemoryEventRepository implements NostrEventRepository {
  private readonly events = new Map<string, StoredNostrEvent>()

  upsert(event: StoredNostrEvent): void {
    const key = event.id ?? JSON.stringify({
      kind: event.kind,
      pubkey: event.pubkey,
      created_at: event.created_at,
      tags: event.tags,
      content: event.content,
      sig: event.sig,
    })
    if (!this.events.has(key)) {
      this.events.set(key, event)
    }
  }

  loadAll(): StoredNostrEvent[] {
    return [...this.events.values()].sort((left, right) => left.created_at - right.created_at)
  }

  loadSince(createdAt: number): StoredNostrEvent[] {
    return this.loadAll().filter((event) => event.created_at >= createdAt)
  }

  close(): void {}
}

export class MemoryNodeStorage implements NodeStorage {
  readonly content: ContentIndexRepository
  readonly events: NostrEventRepository

  constructor() {
    this.content = new MemoryContentRepository()
    this.events = new MemoryEventRepository()
  }

  close(): void {}
}
