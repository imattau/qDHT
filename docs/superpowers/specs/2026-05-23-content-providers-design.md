# Phase 5: Content Providers Design

**Date**: 2026-05-23
**Phase**: 5 — Content Providers

---

## Purpose

Extend the content layer with HTTP fetching, NIP-96 upload, a provider registry, and a piece fetcher service that coordinates multi-source parallel downloads with automatic fallback.

---

## Decisions

- **HTTP provider**: streaming via Node.js fetch + HTTP Range headers (Node 18+ built-in, no new deps)
- **NIP-96 scope**: upload-only; download uses HttpProvider on the returned URL
- **Piece fetcher**: standalone PieceFetcherService (src/node/), not embedded in CLI command
- **Fallback policy**: automatic — fetcher tries next provider on failure, caller gets final result or error
- **Architecture**: ContentProviderRegistry (provider routing table) + pluggable providers

---

## Section 1: ContentProvider Interface

File: `src/core/content/provider.ts`

```typescript
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
```

`getPieceStream` is optional. PieceFetcherService prefers it when present.

---

## Section 2: HttpProvider

File: `src/core/content/http-provider.ts`

- `schemes: ['http', 'https']`
- `supports(url)`: startsWith http:// or https://
- `getPiece(descriptor)`: fetch with Range header, return Buffer. Accepts 200 or 206.
- `getPieceStream(descriptor)`: same but return response.body (ReadableStream)
- Uses Node.js 18+ built-in fetch. No new dependencies.
- Throws on non-2xx (excluding 206). No retries — PieceFetcherService handles fallback.

---

## Section 3: Nip96Provider (upload-only)

File: `src/core/content/nip96-provider.ts`

- `schemes: []`, `supports(): false`, `getPiece(): throws NotSupportedError`
- `upload(data: Buffer, meta: {name, mime}): Promise<{url: string, hash: string}>`
  - POST multipart/form-data to serverUrl
  - Parse response: `{status: "success", nip94_event: {tags: [["url", ...], ["x", sha256]]}}`
  - Return `{url, hash}` from tags
  - Throws `UploadError` on non-2xx or missing tags
  - `// TODO(nip98): attach Authorization header` marks NIP-98 auth extension point

---

## Section 4: ContentProviderRegistry

File: `src/core/content/provider-registry.ts`

```typescript
class ContentProviderRegistry {
  constructor()                               // auto-registers FilesystemProvider + HttpProvider
  register(provider: ContentProvider): void   // append to ordered list
  getForUrl(url: string): ContentProvider | null  // first where supports(url) is true
  all(): ContentProvider[]                    // shallow copy
}
```

- Order is selection mechanism — first match wins
- Default order: FilesystemProvider, HttpProvider (local preferred over network)
- Nip96Provider registered explicitly when config.nip96Servers is set

---

## Section 5: PieceFetcherService

File: `src/node/piece-fetcher-service.ts`

```typescript
class PieceFetcherService extends EventEmitter {
  constructor(
    registry: ContentProviderRegistry,
    replicaStore: ReplicaStore,
    neighbourStateMap: NeighbourStateMap,
    reputationMap: ReputationMap,
    maxConcurrent?: number  // default 4
  )

  fetchContent(opts: {
    qkey: string
    hash: string
    totalPieces: number
    pieceSize: number
    sourceUrl: string
  }): Promise<Buffer>
}
```

Fetch pipeline:
1. Build providers from neighbourStateMap, reputation-weighted
2. selectPiecesToFetch (rare-first) from src/core/content/piece-fetcher.ts
3. Parallel fetch (max 4 concurrent):
   a. registry.getForUrl(providerUrl) → getPieceStream or getPiece
   b. On failure: try next in registry.all()
   c. Final fallback: sourceUrl via HttpProvider
   d. Verify piece sha256
   e. replicaStore.addPiece(hash, index)
   f. emit('progress', {fetched, total})
4. Reassemble pieces in order
5. sha256(reassembled) === hash — throw ContentIntegrityError on mismatch
6. Return Buffer

Events: `'progress'` {fetched, total}, `'piece'` {index, bytes}

---

## Section 6: Integration with live node

QDHTNode.start() additions:
- Instantiate ContentProviderRegistry
- Register Nip96Provider for each config.nip96Servers[] entry
- Instantiate PieceFetcherService, store as this.fetcher

qdht-node get <key> [--out <file>] [--timeout <ms>]:
1. Check local ContentStore.index — return immediately if found
2. Query NeighbourStateMap for providers
3. Get sourceUrl from cached announcement (r or url tag)
4. Call this.fetcher.fetchContent(...)
5. Print progress to stderr if --out specified
6. Write to --out or stdout
7. Exit code 1 if timeout (default 30000ms) exceeded

Config addition: `nip96Servers?: string[]` in config.json

---

## New Dependencies

None. Uses Node.js 18+ built-in fetch throughout.
