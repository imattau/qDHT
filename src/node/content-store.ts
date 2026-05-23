import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PIECE_SIZE = 512 * 1024

export interface ContentLocation {
  qkey: string
  hash: string
  totalPieces: number
  pieceSize: number
  sizeBytes: number
  name?: string
  mime?: string
  createdAt: string
}

export interface PutMeta {
  name?: string
  mime?: string
  ttl: number
}

interface IndexEntry {
  hash: string
  totalPieces: number
  pieceSize: number
  sizeBytes: number
  name?: string
  mime?: string
  createdAt: string
  pieceHashes: string[]
}

type Index = Record<string, IndexEntry>

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

export class ContentStore {
  private indexPath: string

  constructor(private dataDir: string) {
    this.indexPath = join(dataDir, 'index.json')
  }

  private async readIndex(): Promise<Index> {
    try {
      return JSON.parse(await readFile(this.indexPath, 'utf8')) as Index
    } catch {
      return {}
    }
  }

  private async writeIndex(index: Index): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    await writeFile(this.indexPath, `${JSON.stringify(index, null, 2)}\n`)
  }

  async put(data: Buffer, meta: PutMeta): Promise<ContentLocation> {
    const hash = sha256(data)
    const pieceDir = join(this.dataDir, hash)
    await mkdir(pieceDir, { recursive: true })

    const pieces = splitPieces(data)
    const pieceHashes = pieces.map((piece) => sha256(piece))

    for (let index = 0; index < pieces.length; index++) {
      await writeFile(join(pieceDir, `${index}.bin`), pieces[index]!)
    }

    const createdAt = new Date().toISOString()
    const entry: IndexEntry = {
      hash,
      totalPieces: pieces.length,
      pieceSize: PIECE_SIZE,
      sizeBytes: data.length,
      name: meta.name,
      mime: meta.mime,
      createdAt,
      pieceHashes,
    }

    const index = await this.readIndex()
    index[hash] = entry
    await this.writeIndex(index)

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
    try {
      await stat(join(this.dataDir, hash, `${index}.bin`))
      return true
    } catch {
      return false
    }
  }

  async getPiece(hash: string, index: number): Promise<Buffer | null> {
    const indexData = await this.readIndex()
    const entry = indexData[hash]
    if (!entry || index < 0 || index >= entry.totalPieces) {
      return null
    }

    try {
      const piece = await readFile(join(this.dataDir, hash, `${index}.bin`))
      if (sha256(piece) !== entry.pieceHashes[index]) {
        return null
      }
      return piece
    } catch {
      return null
    }
  }

  async getIndex(): Promise<Index> {
    return this.readIndex()
  }
}
