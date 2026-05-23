import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { ContentProviderRegistry } from '../core/content/provider-registry.js'
import { ReplicaStore } from '../core/content/replica-store.js'
import { NeighbourStateMap } from '../core/neighbour-state.js'
import { ReputationMap } from '../core/protocol/reputation.js'
import { PieceFetcherService } from './piece-fetcher-service.js'

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function makeProvider(bufferByRange: Map<string, Buffer>, failOnce = false) {
  let failed = false
  return {
    schemes: ['https'],
    supports: (url: string) => url.startsWith('https://'),
    getPiece: vi.fn(async (descriptor: { url: string; pieceIndex: number; pieceSize: number; totalSize: number }) => {
      if (failOnce && !failed) {
        failed = true
        throw new Error('transient')
      }
      const start = descriptor.pieceIndex * descriptor.pieceSize
      const end = Math.min(descriptor.totalSize, start + descriptor.pieceSize) - 1
      const value = bufferByRange.get(`${descriptor.url}:${start}-${end}`)
      if (!value) {
        throw new Error('missing piece')
      }
      return value
    }),
  }
}

function makeRegistry(providers: Array<{ supports: (url: string) => boolean; getPiece: (...args: any[]) => Promise<Buffer> }>) {
  const registry = new ContentProviderRegistry()
  ;(registry as unknown as { getForUrl: (url: string) => unknown; all: () => unknown[] }).getForUrl = (url: string) =>
    providers.find((provider) => provider.supports(url)) ?? null
  ;(registry as unknown as { getForUrl: (url: string) => unknown; all: () => unknown[] }).all = () => providers.slice()
  return registry
}

describe('PieceFetcherService', () => {
  it('fetches, reassembles, and verifies content with progress events', async () => {
    const content = Buffer.from('hello world piece fetcher test')
    const hash = sha256(content)
    const pieceSize = 8
    const totalPieces = Math.ceil(content.length / pieceSize)
    const ranges = new Map<string, Buffer>()
    for (let i = 0; i < totalPieces; i++) {
      const start = i * pieceSize
      const end = Math.min(totalPieces * pieceSize, start + pieceSize)
      const contentEnd = Math.min(content.length, end)
      ranges.set(`https://example.com/file:${start}-${end - 1}`, content.subarray(start, contentEnd))
    }

    const provider = makeProvider(ranges)
    const registry = makeRegistry([provider as any])
    const fetcher = new PieceFetcherService(
      registry,
      new ReplicaStore(),
      new NeighbourStateMap(),
      new ReputationMap(),
      2,
    )

    const progress: Array<{ fetched: number; total: number }> = []
    const pieces: Array<{ index: number; bytes: number }> = []
    fetcher.on('progress', (value) => progress.push(value as { fetched: number; total: number }))
    fetcher.on('piece', (value) => pieces.push(value as { index: number; bytes: number }))

    const result = await fetcher.fetchContent({
      qkey: 'q1',
      hash,
      totalPieces,
      pieceSize,
      sourceUrl: 'https://example.com/file',
    })

    expect(result).toEqual(content)
    expect(progress).toHaveLength(totalPieces)
    expect(pieces).toHaveLength(totalPieces)
    expect(provider.getPiece).toHaveBeenCalled()
  })

  it('falls back to the next provider on failure', async () => {
    const content = Buffer.from('fallback content')
    const hash = sha256(content)
    const pieceSize = content.length
    const ranges = new Map<string, Buffer>([['https://example.com/file:0-15', content]])
    const failing = makeProvider(ranges, true)
    const succeeding = makeProvider(ranges)
    const registry = makeRegistry([failing as any, succeeding as any])
    const fetcher = new PieceFetcherService(
      registry,
      new ReplicaStore(),
      new NeighbourStateMap(),
      new ReputationMap(),
    )

    const result = await fetcher.fetchContent({
      qkey: 'q2',
      hash,
      totalPieces: 1,
      pieceSize,
      sourceUrl: 'https://example.com/file',
    })

    expect(result).toEqual(content)
    expect(failing.getPiece).toHaveBeenCalled()
    expect(succeeding.getPiece).toHaveBeenCalled()
  })

  it('throws on hash mismatch', async () => {
    const content = Buffer.from('bad hash content')
    const pieceSize = content.length
    const ranges = new Map<string, Buffer>([['https://example.com/file:0-15', content]])
    const registry = makeRegistry([makeProvider(ranges) as any])
    const fetcher = new PieceFetcherService(
      registry,
      new ReplicaStore(),
      new NeighbourStateMap(),
      new ReputationMap(),
    )

    await expect(
      fetcher.fetchContent({
        qkey: 'q3',
        hash: '0'.repeat(64),
        totalPieces: 1,
        pieceSize,
        sourceUrl: 'https://example.com/file',
      }),
    ).rejects.toThrow('hash mismatch')
  })
})
