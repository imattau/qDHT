import { type ContentProvider, type PieceDescriptor } from './provider.js'

function pieceRange(descriptor: PieceDescriptor): string {
  const start = descriptor.pieceIndex * descriptor.pieceSize
  const end = Math.min(descriptor.totalSize, start + descriptor.pieceSize) - 1
  return `bytes=${start}-${Math.max(start, end)}`
}

export class HttpProvider implements ContentProvider {
  readonly schemes = ['http', 'https']

  supports(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://')
  }

  async getPiece(descriptor: PieceDescriptor): Promise<Buffer> {
    const response = await fetch(descriptor.url, {
      headers: { Range: pieceRange(descriptor) },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${descriptor.url}`)
    }

    const body = await response.arrayBuffer()
    return Buffer.from(body)
  }

  async getPieceStream(descriptor: PieceDescriptor): Promise<ReadableStream<Uint8Array>> {
    const response = await fetch(descriptor.url, {
      headers: { Range: pieceRange(descriptor) },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${descriptor.url}`)
    }

    if (!response.body) {
      throw new Error(`HTTP ${response.status} returned no body for ${descriptor.url}`)
    }

    return response.body
  }
}
