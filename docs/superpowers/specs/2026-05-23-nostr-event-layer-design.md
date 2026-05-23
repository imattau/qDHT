# qDHT Nostr Event Layer Design

**Date**: 2026-05-23
**Phase**: 2 — Nostr Event Layer

---

## Purpose

Add the cryptographic identity and event-structure layer that Phase 1 deliberately omitted. Phase 1 protocol builders (`announcement.ts` etc.) produce unsigned event shapes with `sig: ''`. Phase 2 provides:

1. Real secp256k1 keypairs (Nostr node identity)
2. NIP-01 event signing and verification
3. NIP-44 encrypted payloads (via `nostr-tools` v2)
4. Typed event shapes, kind constants, tag helpers, and filter matching

The simulation (`src/sim/`) continues to use `sig: ''` and skips signing entirely. A live node (Phase 3) calls the new `signAnnouncement()` helper to produce a fully signed event.

---

## Architecture: Split `identity/` + `nostr/`

```
src/core/
  identity/          ← cryptographic layer ("who you are")
    keys.ts          — key generation and derivation
    signing.ts       — event signing, verification, event-ID computation
    encryption.ts    — NIP-44 encrypt/decrypt

  nostr/             ← protocol structure layer ("what you send")
    event.ts         — NostrEvent, SignedNostrEvent, isSignedEvent()
    kinds.ts         — QDHT_KIND enum
    tags.ts          — tag accessors and builders
    filter.ts        — NostrFilter type, matchesFilter()

  protocol/          (unchanged Phase 1 files)
    announcement.ts
    replica-record.ts
    delta.ts
    piece-manifest.ts
    reputation.ts
```

`src/core/identity/` has no dependency on `src/core/nostr/`. `src/core/nostr/` has no dependency on `src/core/identity/`. The protocol builders in `src/core/protocol/` depend on neither; they remain pure data constructors. The `signAnnouncement()` helper in `signing.ts` bridges the two.

---

## Design Sections

### 1. `src/core/identity/keys.ts`

**Dependency**: `nostr-tools/pure` (key utils, no DOM).

```ts
export interface Keypair {
  privkey: string  // 32-byte hex
  pubkey: string   // 32-byte hex (x-only secp256k1)
}

export function generateKeypair(): Keypair
export function pubkeyFromPrivkey(privkeyHex: string): string
export function keypairFromHex(privkeyHex: string): Keypair
```

`generateKeypair()` calls `nostr-tools`' `generateSecretKey()` and `getPublicKey()`. Both private and public keys are lowercase hex strings throughout — no `Uint8Array` leaks into callers. `keypairFromHex()` is the round-trip from a stored private key.

**Invariants**:
- Private key is always 64-hex-char (32 bytes).
- Public key is always 64-hex-char (x-only compressed point).
- Both are lowercase.

---

### 2. `src/core/identity/signing.ts`

**Dependency**: `nostr-tools/pure`.

```ts
import { type NostrEvent, type SignedNostrEvent } from '../nostr/event.js'
import { type QDHTAnnouncement } from '../protocol/announcement.js'

// Core NIP-01 primitives
export function eventId(event: NostrEvent): string
export function signEvent(event: NostrEvent, privkeyHex: string): SignedNostrEvent
export function verifyEvent(event: SignedNostrEvent): boolean

// Protocol convenience
export function signAnnouncement(
  ann: QDHTAnnouncement,
  privkeyHex: string,
): SignedNostrEvent
```

**`eventId(event)`**
Computes `sha256(JSON.stringify([0, pubkey, created_at, kind, tags, content]))` per NIP-01. Returns 64-char lowercase hex. Uses `nostr-tools`' `getEventHash()` internally.

**`signEvent(event, privkeyHex)`**
1. Computes `eventId(event)`.
2. Signs with Schnorr via `nostr-tools`' `finalizeEvent()`.
3. Returns a `SignedNostrEvent` (same shape plus `id` and real `sig`).
4. Throws if `privkeyHex` is not 64 hex chars.

**`verifyEvent(event)`**
Delegates to `nostr-tools`' `verifyEvent()`. Returns `false` (not throws) on any invalid input.

**`signAnnouncement(ann, privkeyHex)`**
Convenience: converts a `QDHTAnnouncement` (which has `sig: ''`) into a `NostrEvent`, calls `signEvent`, returns `SignedNostrEvent`. This is the only place the protocol layer and identity layer touch.

---

### 3. `src/core/identity/encryption.ts`

**Dependency**: `nostr-tools/nip44`.

```ts
export function encrypt(
  plaintext: string,
  senderPrivkeyHex: string,
  recipientPubkeyHex: string,
): string

export function decrypt(
  ciphertext: string,
  recipientPrivkeyHex: string,
  senderPubkeyHex: string,
): string
```

Both functions are thin wrappers over `nostr-tools/nip44`'s `encrypt` and `decrypt`. The conversation key derivation (`getConversationKey`) is internal to nostr-tools; callers never touch raw key material. Errors from nostr-tools (invalid key length, bad ciphertext MAC) propagate as thrown `Error` instances — callers must catch.

**Usage context**: Phase 2 does not use encryption directly. It is provided for Phase 3 (private replica sharing, NIP-59 gift-wrap). Tests verify the encrypt/decrypt round-trip and that a wrong key produces an error.

---

### 4. `src/core/nostr/event.ts`

```ts
export interface NostrEvent {
  kind: number
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string          // '' for unsigned (sim), 64-byte hex for signed
}

export interface SignedNostrEvent extends NostrEvent {
  id: string           // NIP-01 event ID (sha256 of canonical JSON)
  sig: string          // 64-byte Schnorr signature hex (non-empty)
}

export function isSignedEvent(event: NostrEvent): event is SignedNostrEvent
```

`isSignedEvent()` checks `typeof event.id === 'string' && event.id.length === 64 && event.sig.length === 128`. It does not re-verify the cryptographic signature — that is `verifyEvent()`'s job.

**Relationship to Phase 1 types**: `QDHTAnnouncement`, `QDHTReplicaRecord`, etc. are subtypes of `NostrEvent` (same shape, narrower `kind` literal). No changes to Phase 1 files. `SignedNostrEvent` is the type returned after signing any of them.

---

### 5. `src/core/nostr/kinds.ts`

```ts
export const QDHT_KIND = {
  ANNOUNCEMENT:      10800,
  REPLICA_RECORD:    10801,
  REPUTATION_DELTA:  10802,
  PIECE_MANIFEST:    10803,
  DELTA_REQUEST:     20800,
  DELTA_RESPONSE:    20801,
} as const

export type QDHTKind = (typeof QDHT_KIND)[keyof typeof QDHT_KIND]

export function isQDHTKind(kind: number): kind is QDHTKind
```

`isQDHTKind()` checks membership in the const object values. Useful for filter guards and incoming message dispatch.

---

### 6. `src/core/nostr/tags.ts`

```ts
// Single-tag access
export function getTag(tags: string[][], name: string): string | undefined
export function getTags(tags: string[][], name: string): string[][]
export function hasTag(tags: string[][], name: string): boolean

// Multi-tag map (first value per tag name)
export function buildTagMap(tags: string[][]): Map<string, string>
```

**`getTag(tags, name)`** — returns the first value (`tags[i][1]`) of the first tag whose `tags[i][0] === name`, or `undefined`. Matches Phase 1's existing `getTag()` in `announcement.ts` but generalised to work on any `string[][]`.

**`getTags(tags, name)`** — returns all tag entries (each entry is `string[]`) whose first element matches `name`.

**`hasTag(tags, name)`** — boolean shorthand.

**`buildTagMap(tags)`** — scans all tags once, returns a `Map<string, string>` of `name → first value`. Useful for O(1) access when many tags are checked together (e.g. inside `matchesFilter()`).

---

### 7. `src/core/nostr/filter.ts`

```ts
export interface NostrFilter {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number          // unix timestamp, inclusive lower bound
  until?: number          // unix timestamp, inclusive upper bound
  limit?: number
  [tag: `#${string}`]: string[] | undefined   // e.g. '#qkey': ['abc123']
}

export function matchesFilter(event: NostrEvent, filter: NostrFilter): boolean
```

**`matchesFilter(event, filter)`** — returns `true` iff the event satisfies every non-undefined filter field:
- `ids`: `event.id` starts with any entry (prefix match per NIP-01). For unsigned events without `id`, this always returns `false` when `ids` is set.
- `authors`: `event.pubkey` starts with any entry.
- `kinds`: `event.kind` is in the array.
- `since` / `until`: `event.created_at` is within the range (both inclusive).
- `#X` tag filters: the event has at least one tag `['X', v]` where `v` is in the filter array.

`limit` is not checked by `matchesFilter()` — it is a relay-side cursor hint, not a per-event predicate.

---

## `signAnnouncement` Integration Pattern

Phase 1 sim usage (unchanged):
```ts
const ann = buildAnnouncement({ pubkey: node.id, ... })
// ann.sig === '' — fine for simulation
node.receiveAnnouncement(ann, fromNode, round)
```

Phase 3 live node usage:
```ts
import { signAnnouncement } from '@core/identity/signing.js'
const ann = buildAnnouncement({ pubkey: keypair.pubkey, ... })
const signed = signAnnouncement(ann, keypair.privkey)
// signed.id and signed.sig are populated
relay.publish(signed)
```

---

## Dependencies

| Package | Used by | Purpose |
|---|---|---|
| `nostr-tools` | `identity/keys.ts`, `identity/signing.ts`, `identity/encryption.ts` | secp256k1 key gen, Schnorr signing, NIP-44 AEAD |

`nostr-tools` v2 ships NIP-44 in the main package under `nostr-tools/nip44`. No additional packages required. `@noble/secp256k1` is already a transitive dependency of `nostr-tools` and need not be installed separately.

---

## Test Coverage

| File | Tests |
|---|---|
| `keys.test.ts` | `generateKeypair()` returns valid hex lengths; `pubkeyFromPrivkey()` is deterministic; `keypairFromHex()` round-trips |
| `signing.test.ts` | `eventId()` matches known vector; `signEvent()` produces verifiable sig; `verifyEvent()` returns false for tampered event; `signAnnouncement()` produces `SignedNostrEvent` with correct kind |
| `encryption.test.ts` | encrypt/decrypt round-trip; wrong recipient key throws |
| `event.test.ts` | `isSignedEvent()` true for signed, false for unsigned |
| `kinds.test.ts` | `isQDHTKind()` accepts all six kinds, rejects others |
| `tags.test.ts` | `getTag()`, `getTags()`, `hasTag()`, `buildTagMap()` against fixed tag arrays |
| `filter.test.ts` | `matchesFilter()` for each filter field independently; combined filter; empty filter matches all |

All tests use `nostr-tools` directly (no mocks) to ensure real crypto is exercised.

---

## What Is Unchanged from Phase 1

- `src/core/protocol/announcement.ts` — `buildAnnouncement()`, `isValidAnnouncement()`, `getTag()` (local helper, not removed)
- `src/core/protocol/replica-record.ts`, `delta.ts`, `piece-manifest.ts`, `reputation.ts`
- `src/sim/` — entire simulation layer; SimNode continues to use `sig: ''`
- All Phase 1 tests — no modifications

---

## What Is New in Phase 2

- `src/core/identity/keys.ts` — `generateKeypair()`, `pubkeyFromPrivkey()`, `keypairFromHex()`
- `src/core/identity/signing.ts` — `eventId()`, `signEvent()`, `verifyEvent()`, `signAnnouncement()`
- `src/core/identity/encryption.ts` — `encrypt()`, `decrypt()` (NIP-44)
- `src/core/nostr/event.ts` — `NostrEvent`, `SignedNostrEvent`, `isSignedEvent()`
- `src/core/nostr/kinds.ts` — `QDHT_KIND`, `QDHTKind`, `isQDHTKind()`
- `src/core/nostr/tags.ts` — `getTag()`, `getTags()`, `hasTag()`, `buildTagMap()`
- `src/core/nostr/filter.ts` — `NostrFilter`, `matchesFilter()`
- `package.json` — add `nostr-tools` as a dependency
