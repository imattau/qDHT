import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { HttpProvider } from '../core/content/http-provider.js'
import { selectPiecesToFetch, type PieceProvider } from '../core/content/piece-fetcher.js'
import { type ContentProvider, type PieceDescriptor } from '../core/content/provider.js'
import { ContentProviderRegistry } from '../core/content/provider-registry.js'
import { NeighbourStateMap } from '../core/neighbour-state.js'
import { ReputationMap } from '../core/protocol/reputation.js'
import { ReplicaStore } from '../core/content/replica-store.js'

export class ContentIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentIntegrityError'
  }
}

export interface FetchContentOpts {
  qkey: string
  hash: string
  totalPieces: number
  pieceSize: number
  sourceUrl: string
}

export class PieceFetcherService extends EventEmitter {
  private readonly fallbackProvider = new HttpProvider()
  private readonly pieceCache = new Map<string, Map<number, Buffer>>()

  constructor(
    private registry: ContentProviderRegistry,
    private replicaStore: ReplicaStore,
    private neighbourState: NeighbourStateMap,
    private reputationMap: ReputationMap,
    private maxConcurrent = 4,
  ) {
    super()
  }

  async fetchContent(opts: FetchContentOpts): Promise<Buffer> {
    const { qkey, hash, totalPieces, pieceSize, sourceUrl } = opts
    this.replicaStore.declareTotal(hash, totalPieces)
    const cache = this.pieceCache.get(hash) ?? new Map<number, Buffer>()
    this.pieceCache.set(hash, cache)

    const providers = this.buildNeighbourProviders(qkey, totalPieces)
    const selected = selectPiecesToFetch(hash, totalPieces, this.replicaStore, providers)
    const selectedIndices = new Set(selected.map((task) => task.pieceIndex))
    const missing = Array.from({ length: totalPieces }, (_, index) => index).filter((index) => !cache.has(index))
    const queue = [...selected.map((task) => task.pieceIndex), ...missing.filter((index) => !selectedIndices.has(index))]

    const pieces = new Array<Buffer>(totalPieces)
    for (let index = 0; index < totalPieces; index++) {
      const cached = cache.get(index)
      if (cached) {
        pieces[index] = cached
      }
    }
    let fetched = 0

    const worker = async (): Promise<void> => {
      while (true) {
        const index = queue.shift()
        if (index === undefined) {
          return
        }

        const task = selected.find((t) => t.pieceIndex === index)
        const data = await this.fetchPiece(sourceUrl, index, pieceSize, totalPieces, task?.provider)
        pieces[index] = data
        cache.set(index, data)
        this.replicaStore.addPiece(hash, index)
        fetched += 1
        this.emit('piece', { index, bytes: data.length })
        this.emit('progress', { fetched, total: totalPieces })
      }
    }

    const workerCount = Math.max(1, Math.min(this.maxConcurrent, queue.length || 1))
    await Promise.all(Array.from({ length: workerCount }, () => worker()))

    const assembled = Buffer.concat(pieces.map((piece) => piece ?? Buffer.alloc(0)))
    const digest = createHash('sha256').update(assembled).digest('hex')
    if (digest !== hash) {
      for (const task of selected) {
        this.reputationMap.adjust(task.provider, -0.2)
      }
      throw new ContentIntegrityError(`assembled hash mismatch for ${qkey}`)
    }
    return assembled
  }

  private buildNeighbourProviders(qkey: string, totalPieces: number): PieceProvider[] {
    const state = this.neighbourState.get(qkey)
    if (!state) {
      return []
    }

    const providers: PieceProvider[] = []
    for (const [nodeId, neighbour] of state.inbound) {
      const pieceRanges = neighbour.pieceRanges.length > 0
        ? neighbour.pieceRanges
        : neighbour.hasReplica
          ? [[0, totalPieces - 1] as [number, number]]
          : []
      if (pieceRanges.length === 0) {
        continue
      }

      providers.push({
        nodeId,
        reputation: this.reputationMap.get(nodeId),
        pieceRanges,
      })
    }
    return providers
  }

  private async fetchPiece(sourceUrl: string, pieceIndex: number, pieceSize: number, totalPieces: number, nodeId?: string): Promise<Buffer> {
    const descriptor: PieceDescriptor = {
      url: sourceUrl,
      pieceIndex,
      pieceSize,
      totalSize: totalPieces * pieceSize,
    }

    const providers = this.providersForUrl(sourceUrl)
    let lastError: unknown = null
    for (const provider of providers) {
      try {
        const buffer = await this.readPiece(provider, descriptor)
        return buffer
      } catch (err) {
        lastError = err
        if (nodeId) {
          this.reputationMap.adjust(nodeId, -0.05)
        }
      }
    }

    if (lastError instanceof Error) {
      throw lastError
    }
    throw new Error(`failed to fetch piece ${pieceIndex} from ${sourceUrl}`)
  }

  private providersForUrl(url: string): ContentProvider[] {
    const providers: ContentProvider[] = []
    const primary = this.registry.getForUrl(url)
    if (primary) {
      providers.push(primary)
    }

    for (const provider of this.registry.all()) {
      if (provider.supports(url) && !providers.includes(provider)) {
        providers.push(provider)
      }
    }

    if (!providers.includes(this.fallbackProvider)) {
      providers.push(this.fallbackProvider)
    }

    return providers
  }

  private async readPiece(provider: ContentProvider, descriptor: PieceDescriptor): Promise<Buffer> {
    if (provider.getPieceStream) {
      const stream = await provider.getPieceStream(descriptor)
      return await this.streamToBuffer(stream)
    }
    return await provider.getPiece(descriptor)
  }

  private async streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
    const reader = stream.getReader()
    const chunks: Buffer[] = []
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        if (value) {
          chunks.push(Buffer.from(value))
        }
      }
    } finally {
      reader.releaseLock()
    }
    return Buffer.concat(chunks)
  }
}
