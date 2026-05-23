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

export interface ContentIndexEntry {
  hash: string
  totalPieces: number
  pieceSize: number
  sizeBytes: number
  name?: string
  mime?: string
  createdAt: string
  pieceHashes: string[]
  ttl: number
}

export interface ContentIndexRepository {
  put(data: Buffer, meta: PutMeta): Promise<ContentLocation>
  hasPiece(hash: string, index: number): Promise<boolean>
  getPiece(hash: string, index: number): Promise<Buffer | null>
  getIndex(): Promise<Record<string, ContentIndexEntry>>
  close(): void
}
