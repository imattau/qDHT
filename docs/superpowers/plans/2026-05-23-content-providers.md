# Phase 5: Content Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a pluggable content provider system with HTTP streaming, NIP-96 upload, provider registry, and a parallel piece-fetcher service that coordinates multi-source downloads with automatic fallback and integrity verification.

**Architecture:** ContentProvider interface defines pluggable strategies (HttpProvider, Nip96Provider, FilesystemProvider). ContentProviderRegistry maintains an ordered list where first matching provider handles a URL. PieceFetcherService uses the registry to fetch pieces in parallel (rare-first), falling back to the next provider on failure, then reassembles and verifies the complete content against its hash. QDHTNode integrates the registry and fetcher into start(), and the get command queries NeighbourStateMap, calls fetchContent(), and streams output with progress.

**Tech Stack:** Node.js 18+ (built-in fetch + streams), no new dependencies. TypeScript with EventEmitter for progress events.

---

## File Structure

```
src/core/content/
  provider.ts                  # ContentProvider interface + types
  http-provider.ts             # HTTP(S) streaming provider
  nip96-provider.ts            # NIP-96 upload-only provider
  filesystem-provider.ts       # Local filesystem provider (already exists, no changes)
  provider-registry.ts         # Ordered provider registry
  piece-fetcher.ts             # Rare-first piece selection algorithm
  content-integrity-error.ts   # ContentIntegrityError exception class

src/node/
  piece-fetcher-service.ts     # PieceFetcherService with parallel fetch + fallback

src/commands/
  get.ts                       # Updated to use PieceFetcherService

test/core/content/
  provider.test.ts
  http-provider.test.ts
  nip96-provider.test.ts
  provider-registry.test.ts
  piece-fetcher.test.ts

test/node/
  piece-fetcher-service.test.ts

test/commands/
  get.test.ts
```

---

## Task 1: ContentProvider Interface Types

**Files:**
- Create: `src/core/content/provider.ts`
- Create: `src/core/content/content-integrity-error.ts`

- [ ] **Step 1: Write the ContentProvider interface test**

Create `test/core/content/provider.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type {
  PieceDescriptor,
  ContentProvider,
  ContentMeta,
  ContentLocation,
} from '../../../src/core/content/provider'

describe('ContentProvider interface types', () => {
  it('PieceDescriptor has required properties', () => {
    const descriptor: PieceDescriptor = {
      url: 'https://example.com/file',
      pieceIndex: 0,
      pieceSize: 65536,
      totalSize: 1048576,
    }
    expect(descriptor.url).toBe('https://example.com/file')
    expect(descriptor.pieceIndex).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/mattthomson/workspace/qDHT
npm test -- test/core/content/provider.test.ts
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create provider.ts with all interface types**

Create `src/core/content/provider.ts` with PieceDescriptor, ContentProvider, ContentMeta, ContentLocation interfaces.

- [ ] **Step 4: Create ContentIntegrityError exception class**

Create `src/core/content/content-integrity-error.ts`.

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- test/core/content/provider.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/content/provider.ts src/core/content/content-integrity-error.ts test/core/content/provider.test.ts
git commit -m "feat: add ContentProvider interface and types"
```

---

## Task 2: HttpProvider Implementation

**Files:**
- Create: `src/core/content/http-provider.ts`
- Create: `test/core/content/http-provider.test.ts`

- [ ] **Step 1: Write HttpProvider tests**

Create `test/core/content/http-provider.test.ts` covering: schemes, supports(), getPiece with Range headers, getPieceStream, error handling.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/core/content/http-provider.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement HttpProvider**

Create `src/core/content/http-provider.ts` implementing ContentProvider interface with streaming and Range headers.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/core/content/http-provider.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/content/http-provider.ts test/core/content/http-provider.test.ts
git commit -m "feat: add HttpProvider with streaming and Range headers"
```

---

## Task 3: Nip96Provider (Upload-Only)

**Files:**
- Create: `src/core/content/nip96-provider.ts`
- Create: `test/core/content/nip96-provider.test.ts`

- [ ] **Step 1: Write Nip96Provider tests**

Create `test/core/content/nip96-provider.test.ts` covering: empty schemes, supports() returns false, getPiece throws, upload() with multipart form, response parsing.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/core/content/nip96-provider.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement Nip96Provider**

Create `src/core/content/nip96-provider.ts` with upload() method and UploadError exception. Include TODO for NIP-98 auth.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/core/content/nip96-provider.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/content/nip96-provider.ts test/core/content/nip96-provider.test.ts
git commit -m "feat: add Nip96Provider for upload-only file transfers"
```

---

## Task 4: ContentProviderRegistry

**Files:**
- Create: `src/core/content/provider-registry.ts`
- Create: `test/core/content/provider-registry.test.ts`

- [ ] **Step 1: Write ContentProviderRegistry tests**

Create `test/core/content/provider-registry.test.ts` covering: auto-registration of FilesystemProvider and HttpProvider, getForUrl(), all(), register(), order matters.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/core/content/provider-registry.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement ContentProviderRegistry**

Create `src/core/content/provider-registry.ts` with ordered provider list and first-match lookup.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/core/content/provider-registry.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/content/provider-registry.ts test/core/content/provider-registry.test.ts
git commit -m "feat: add ContentProviderRegistry with ordered provider lookup"
```

---

## Task 5: Piece Selection Algorithm (Rare-First)

**Files:**
- Create: `src/core/content/piece-fetcher.ts`
- Create: `test/core/content/piece-fetcher.test.ts`

- [ ] **Step 1: Write piece selection tests**

Create `test/core/content/piece-fetcher.test.ts` testing selectPiecesToFetch() function: returns all indices, rare-first order, empty input.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/core/content/piece-fetcher.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement piece selection**

Create `src/core/content/piece-fetcher.ts` with selectPiecesToFetch() function.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/core/content/piece-fetcher.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/content/piece-fetcher.ts test/core/content/piece-fetcher.test.ts
git commit -m "feat: add rare-first piece selection algorithm"
```

---

## Task 6: PieceFetcherService with Parallel Fetch and Fallback

**Files:**
- Create: `src/node/piece-fetcher-service.ts`
- Create: `test/node/piece-fetcher-service.test.ts`

- [ ] **Step 1: Write PieceFetcherService tests**

Create `test/node/piece-fetcher-service.test.ts` covering: fetchContent(), reassembly, hash verification, progress events, fallback on provider failure, EventEmitter interface.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/node/piece-fetcher-service.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement PieceFetcherService**

Create `src/node/piece-fetcher-service.ts` extending EventEmitter. Implements: parallelFetch with concurrency limit, fallback logic, reassemble, integrity verification, progress events.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/node/piece-fetcher-service.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/node/piece-fetcher-service.ts test/node/piece-fetcher-service.test.ts
git commit -m "feat: add PieceFetcherService with parallel fetch and fallback"
```

---

## Task 7: QDHTNode Integration

**Files:**
- Modify: `src/node/qdht-node.ts`

- [ ] **Step 1: Update QDHTNode.start() to initialize fetcher**

In start() method, add:
- Initialize ContentProviderRegistry
- Register Nip96Provider for each config.nip96Servers entry
- Create PieceFetcherService and store as this.fetcher

- [ ] **Step 2: Write test for QDHTNode.start() registration**

Create test in `test/node/qdht-node.test.ts` verifying this.fetcher is initialized.

- [ ] **Step 3: Run the test to verify it passes**

```bash
npm test -- test/node/qdht-node.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/node/qdht-node.ts test/node/qdht-node.test.ts
git commit -m "feat: integrate PieceFetcherService into QDHTNode.start()"
```

---

## Task 8: Updated get Command with PieceFetcher

**Files:**
- Modify: `src/commands/get.ts`
- Modify: `test/commands/get.test.ts`

- [ ] **Step 1: Update get command to use fetcher**

In `src/commands/get.ts`, update getCommand():
1. Check local ContentStore.index first (return immediately if found)
2. Query NeighbourStateMap for provider metadata
3. Get sourceUrl from cached announcement
4. Call this.fetcher.fetchContent() with timeout
5. Listen to progress events (emit to stderr if --out)
6. Write to --out or stdout
7. Exit code 1 on timeout

- [ ] **Step 2: Write test for get command with fetcher**

Create tests in `test/commands/get.test.ts` covering: local cache hit, fetcher call, timeout, --out file write, progress events.

- [ ] **Step 3: Run tests to verify they pass**

```bash
npm test -- test/commands/get.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/commands/get.ts test/commands/get.test.ts
git commit -m "feat: update get command to use PieceFetcherService"
```

---

## Task 9: Add Configuration Type for nip96Servers

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Write test for config type**

Create test in `test/config.test.ts` verifying QDHTConfig accepts optional nip96Servers array.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/config.test.ts
```

Expected: FAIL

- [ ] **Step 3: Update config type**

In `src/config.ts`, add `nip96Servers?: string[]` to QDHTConfig interface.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/config.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: add nip96Servers to QDHTConfig"
```

---

## Task 10: Full Integration Test

**Files:**
- Create: `test/integration/content-providers.integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `test/integration/content-providers.integration.test.ts` covering:
- Registry includes HttpProvider and FilesystemProvider
- PieceFetcherService fetches and reassembles content
- get command uses PieceFetcherService
- End-to-end wiring

- [ ] **Step 2: Run integration test**

```bash
npm test -- test/integration/content-providers.integration.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/integration/content-providers.integration.test.ts
git commit -m "test: add content providers integration tests"
```

---

## Summary

This plan implements Phase 5 (Content Providers) in 10 bite-sized TDD tasks:

1. ContentProvider Interface — types and exceptions
2. HttpProvider — streaming HTTP(S) with Range headers
3. Nip96Provider — multipart upload
4. ContentProviderRegistry — ordered provider routing
5. Piece Selection — rare-first algorithm
6. PieceFetcherService — parallel fetch with fallback and integrity verification
7. QDHTNode Integration — initialize fetcher on start()
8. get Command Updates — local check, progress, timeout
9. Configuration — add nip96Servers option
10. Integration Tests — verify end-to-end wiring

No dependencies added. All code uses Node.js 18+ built-in fetch and streams.

**Execution:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute tasks with checkpoints.
