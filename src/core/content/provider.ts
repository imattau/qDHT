import type { ReadableStream } from 'node:stream/web'

export interface PieceDescriptor {
  url: string
  pieceIndex: number
  pieceSize: number
  totalSize: number
}

export interface ContentProvider {
  readonly schemes: string[]
  supports(url: string): boolean
  getPiece(descriptor: PieceDescriptor): Promise<Buffer>
  getPieceStream?(descriptor: PieceDescriptor): Promise<ReadableStream<Uint8Array>>
}

export interface ContentMeta {
  name: string
  mime: string
  hash: string
  totalPieces: number
  pieceSize: number
}

export interface ContentLocation {
  qkey: string
  hash: string
  url?: string
}
