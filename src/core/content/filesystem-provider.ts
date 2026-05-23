import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { type ContentProvider, type PieceDescriptor } from './provider.js'

function resolvePath(url: string): string {
  if (url.startsWith('file://')) {
    return fileURLToPath(url)
  }
  return url
}

export class FilesystemProvider implements ContentProvider {
  readonly schemes = ['file']

  supports(url: string): boolean {
    return url.startsWith('file://') || url.startsWith('/')
  }

  async getPiece(descriptor: PieceDescriptor): Promise<Buffer> {
    const data = await readFile(resolvePath(descriptor.url))
    const start = descriptor.pieceIndex * descriptor.pieceSize
    const end = Math.min(descriptor.totalSize, start + descriptor.pieceSize)
    return data.subarray(start, end)
  }
}
