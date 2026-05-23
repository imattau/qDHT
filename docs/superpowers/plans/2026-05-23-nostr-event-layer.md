# Nostr Event Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the cryptographic identity and event-structure layer (Phase 2) — secp256k1 keypairs, NIP-01 signing/verification, NIP-44 encryption, typed event shapes, kind constants, tag helpers, and filter matching.

**Architecture:** Two independent modules: `src/core/identity/` (who you are — crypto primitives) and `src/core/nostr/` (what you send — protocol structure). They share no imports. A single bridge helper `signAnnouncement()` in `signing.ts` is the only point where the two worlds meet. Phase 1 files are untouched; the sim continues to use `sig: ''`.

**Tech Stack:** TypeScript (ESM), Vitest, `nostr-tools` v2 (`nostr-tools/pure`, `nostr-tools/nip44`)

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/core/nostr/event.ts` | Create | `NostrEvent`, `SignedNostrEvent` types, `isSignedEvent()` |
| `src/core/nostr/kinds.ts` | Create | `QDHT_KIND` enum, `QDHTKind`, `isQDHTKind()` |
| `src/core/nostr/tags.ts` | Create | `getTag()`, `getTags()`, `hasTag()`, `buildTagMap()` |
| `src/core/nostr/filter.ts` | Create | `NostrFilter`, `matchesFilter()` |
| `src/core/identity/keys.ts` | Create | `Keypair`, `generateKeypair()`, `pubkeyFromPrivkey()`, `keypairFromHex()` |
| `src/core/identity/signing.ts` | Create | `eventId()`, `signEvent()`, `verifyEvent()`, `signAnnouncement()` |
| `src/core/identity/encryption.ts` | Create | NIP-44 `encrypt()`, `decrypt()` |
| `src/core/protocol/announcement.ts` | Modify | Add `signAnnouncement` re-export note (no functional change needed — bridge lives in signing.ts) |
| `package.json` | Modify | Add `nostr-tools` runtime dependency |
| Test files (7 total) | Create | One per module |

---

### Task 0: Install `nostr-tools`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
npm install nostr-tools
```

- [ ] **Step 2: Verify it installed**

```bash
node -e "import('nostr-tools/pure').then(m => console.log(Object.keys(m)))"
```

Expected: prints an array including `generateSecretKey`, `getPublicKey`, `finalizeEvent`, `verifyEvent`, `getEventHash`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add nostr-tools dependency"
```

---

### Task 1: `src/core/nostr/event.ts` — Event types

**Files:**
- Create: `src/core/nostr/event.ts`
- Create: `src/core/nostr/event.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/nostr/event.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isSignedEvent, type NostrEvent, type SignedNostrEvent } from './event.js'

describe('isSignedEvent', () => {
  const base: NostrEvent = {
    kind: 10800,
    pubkey: 'a'.repeat(64),
    created_at: 1000000,
    tags: [],
    content: '',
    sig: '',
  }

  it('returns false for unsigned event (no id, empty sig)', () => {
    expect(isSignedEvent(base)).toBe(false)
  })

  it('returns false when id is wrong length', () => {
    const event = { ...base, id: 'abc', sig: 'f'.repeat(128) }
    expect(isSignedEvent(event)).toBe(false)
  })

  it('returns false when sig is wrong length', () => {
    const event = { ...base, id: 'a'.repeat(64), sig: 'tooshort' }
    expect(isSignedEvent(event)).toBe(false)
  })

  it('returns true for event with valid id and sig lengths', () => {
    const signed: SignedNostrEvent = {
      ...base,
      id: 'a'.repeat(64),
      sig: 'b'.repeat(128),
    }
    expect(isSignedEvent(signed)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/nostr/event.test.ts
```

Expected: FAIL — cannot find module `./event.js`

- [ ] **Step 3: Write the implementation**

Create `src/core/nostr/event.ts`:

```ts
export interface NostrEvent {
  kind: number
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string  // '' for unsigned (sim); 128-char hex for signed
}

export interface SignedNostrEvent extends NostrEvent {
  id: string   // 64-char hex — NIP-01 sha256 of canonical JSON
  sig: string  // 128-char hex Schnorr signature (non-empty)
}

export function isSignedEvent(event: NostrEvent): event is SignedNostrEvent {
  const e = event as Partial<SignedNostrEvent>
  return (
    typeof e.id === 'string' &&
    e.id.length === 64 &&
    e.sig.length === 128
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/nostr/event.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/nostr/event.ts src/core/nostr/event.test.ts
git commit -m "feat: add NostrEvent types and isSignedEvent()"
```

---

### Task 2: `src/core/nostr/kinds.ts` — Kind constants

**Files:**
- Create: `src/core/nostr/kinds.ts`
- Create: `src/core/nostr/kinds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/nostr/kinds.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { QDHT_KIND, isQDHTKind } from './kinds.js'

describe('QDHT_KIND', () => {
  it('has the expected numeric values', () => {
    expect(QDHT_KIND.ANNOUNCEMENT).toBe(10800)
    expect(QDHT_KIND.REPLICA_RECORD).toBe(10801)
    expect(QDHT_KIND.REPUTATION_DELTA).toBe(10802)
    expect(QDHT_KIND.PIECE_MANIFEST).toBe(10803)
    expect(QDHT_KIND.DELTA_REQUEST).toBe(20800)
    expect(QDHT_KIND.DELTA_RESPONSE).toBe(20801)
  })
})

describe('isQDHTKind', () => {
  it('accepts all six valid kinds', () => {
    expect(isQDHTKind(10800)).toBe(true)
    expect(isQDHTKind(10801)).toBe(true)
    expect(isQDHTKind(10802)).toBe(true)
    expect(isQDHTKind(10803)).toBe(true)
    expect(isQDHTKind(20800)).toBe(true)
    expect(isQDHTKind(20801)).toBe(true)
  })

  it('rejects unknown kinds', () => {
    expect(isQDHTKind(0)).toBe(false)
    expect(isQDHTKind(1)).toBe(false)
    expect(isQDHTKind(10799)).toBe(false)
    expect(isQDHTKind(99999)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/nostr/kinds.test.ts
```

Expected: FAIL — cannot find module `./kinds.js`

- [ ] **Step 3: Write the implementation**

Create `src/core/nostr/kinds.ts`:

```ts
export const QDHT_KIND = {
  ANNOUNCEMENT:     10800,
  REPLICA_RECORD:   10801,
  REPUTATION_DELTA: 10802,
  PIECE_MANIFEST:   10803,
  DELTA_REQUEST:    20800,
  DELTA_RESPONSE:   20801,
} as const

export type QDHTKind = (typeof QDHT_KIND)[keyof typeof QDHT_KIND]

const VALID_KINDS = new Set<number>(Object.values(QDHT_KIND))

export function isQDHTKind(kind: number): kind is QDHTKind {
  return VALID_KINDS.has(kind)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/nostr/kinds.test.ts
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/nostr/kinds.ts src/core/nostr/kinds.test.ts
git commit -m "feat: add QDHT_KIND constants and isQDHTKind()"
```

---

### Task 3: `src/core/nostr/tags.ts` — Tag helpers

**Files:**
- Create: `src/core/nostr/tags.ts`
- Create: `src/core/nostr/tags.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/nostr/tags.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getTag, getTags, hasTag, buildTagMap } from './tags.js'

const tags: string[][] = [
  ['qkey', 'abc123'],
  ['hash', 'deadbeef'],
  ['hash', 'cafebabe'],
  ['size', '1024'],
]

describe('getTag', () => {
  it('returns first value of first matching tag', () => {
    expect(getTag(tags, 'qkey')).toBe('abc123')
  })

  it('returns first value when multiple tags share a name', () => {
    expect(getTag(tags, 'hash')).toBe('deadbeef')
  })

  it('returns undefined for absent tag', () => {
    expect(getTag(tags, 'missing')).toBeUndefined()
  })
})

describe('getTags', () => {
  it('returns all entries matching name', () => {
    expect(getTags(tags, 'hash')).toEqual([
      ['hash', 'deadbeef'],
      ['hash', 'cafebabe'],
    ])
  })

  it('returns empty array for absent tag', () => {
    expect(getTags(tags, 'missing')).toEqual([])
  })
})

describe('hasTag', () => {
  it('returns true for present tag', () => {
    expect(hasTag(tags, 'size')).toBe(true)
  })

  it('returns false for absent tag', () => {
    expect(hasTag(tags, 'missing')).toBe(false)
  })
})

describe('buildTagMap', () => {
  it('maps each name to its first value', () => {
    const map = buildTagMap(tags)
    expect(map.get('qkey')).toBe('abc123')
    expect(map.get('hash')).toBe('deadbeef')  // first hash wins
    expect(map.get('size')).toBe('1024')
  })

  it('returns empty map for no tags', () => {
    expect(buildTagMap([])).toEqual(new Map())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/nostr/tags.test.ts
```

Expected: FAIL — cannot find module `./tags.js`

- [ ] **Step 3: Write the implementation**

Create `src/core/nostr/tags.ts`:

```ts
export function getTag(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1]
}

export function getTags(tags: string[][], name: string): string[][] {
  return tags.filter((t) => t[0] === name)
}

export function hasTag(tags: string[][], name: string): boolean {
  return tags.some((t) => t[0] === name)
}

export function buildTagMap(tags: string[][]): Map<string, string> {
  const map = new Map<string, string>()
  for (const tag of tags) {
    if (!map.has(tag[0]) && tag[1] !== undefined) {
      map.set(tag[0], tag[1])
    }
  }
  return map
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/nostr/tags.test.ts
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/nostr/tags.ts src/core/nostr/tags.test.ts
git commit -m "feat: add tag helpers getTag, getTags, hasTag, buildTagMap"
```

---

### Task 4: `src/core/nostr/filter.ts` — Filter matching

**Files:**
- Create: `src/core/nostr/filter.ts`
- Create: `src/core/nostr/filter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/nostr/filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchesFilter, type NostrFilter } from './filter.js'
import { type NostrEvent } from './event.js'

const event: NostrEvent & { id: string } = {
  id: 'abcd1234' + '0'.repeat(56),
  kind: 10800,
  pubkey: 'pub1' + '0'.repeat(60),
  created_at: 1000000,
  tags: [
    ['qkey', 'mykey'],
    ['hash', 'deadbeef'],
  ],
  content: '',
  sig: 'f'.repeat(128),
}

describe('matchesFilter', () => {
  it('empty filter matches any event', () => {
    expect(matchesFilter(event, {})).toBe(true)
  })

  it('ids: prefix match passes', () => {
    expect(matchesFilter(event, { ids: ['abcd1234'] })).toBe(true)
  })

  it('ids: prefix match fails for wrong prefix', () => {
    expect(matchesFilter(event, { ids: ['deadbeef'] })).toBe(false)
  })

  it('ids: unsigned event (no id) fails when ids filter set', () => {
    const unsigned: NostrEvent = { ...event, sig: '', id: undefined as unknown as string }
    expect(matchesFilter(unsigned, { ids: ['abcd1234'] })).toBe(false)
  })

  it('authors: prefix match passes', () => {
    expect(matchesFilter(event, { authors: ['pub1'] })).toBe(true)
  })

  it('authors: prefix match fails', () => {
    expect(matchesFilter(event, { authors: ['aaaa'] })).toBe(false)
  })

  it('kinds: matches when kind is in list', () => {
    expect(matchesFilter(event, { kinds: [10800, 10801] })).toBe(true)
  })

  it('kinds: fails when kind not in list', () => {
    expect(matchesFilter(event, { kinds: [10801] })).toBe(false)
  })

  it('since: inclusive lower bound passes', () => {
    expect(matchesFilter(event, { since: 1000000 })).toBe(true)
  })

  it('since: event before lower bound fails', () => {
    expect(matchesFilter(event, { since: 1000001 })).toBe(false)
  })

  it('until: inclusive upper bound passes', () => {
    expect(matchesFilter(event, { until: 1000000 })).toBe(true)
  })

  it('until: event after upper bound fails', () => {
    expect(matchesFilter(event, { until: 999999 })).toBe(false)
  })

  it('#qkey tag filter passes when value matches', () => {
    expect(matchesFilter(event, { '#qkey': ['mykey'] })).toBe(true)
  })

  it('#qkey tag filter fails when value does not match', () => {
    expect(matchesFilter(event, { '#qkey': ['otherkey'] })).toBe(false)
  })

  it('#hash tag filter passes with one of multiple values', () => {
    expect(matchesFilter(event, { '#hash': ['deadbeef', 'cafebabe'] })).toBe(true)
  })

  it('combined filter: all conditions must pass', () => {
    expect(matchesFilter(event, {
      kinds: [10800],
      since: 999999,
      until: 1000001,
      '#qkey': ['mykey'],
    })).toBe(true)
  })

  it('combined filter: one failing condition fails the whole filter', () => {
    expect(matchesFilter(event, {
      kinds: [10800],
      '#qkey': ['wrongkey'],
    })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/nostr/filter.test.ts
```

Expected: FAIL — cannot find module `./filter.js`

- [ ] **Step 3: Write the implementation**

Create `src/core/nostr/filter.ts`:

```ts
import { type NostrEvent } from './event.js'

export interface NostrFilter {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  [tag: string]: string[] | number | undefined
}

export function matchesFilter(event: NostrEvent, filter: NostrFilter): boolean {
  const signed = event as NostrEvent & { id?: string }

  if (filter.ids !== undefined) {
    if (!signed.id || !filter.ids.some((prefix) => signed.id!.startsWith(prefix))) {
      return false
    }
  }

  if (filter.authors !== undefined) {
    if (!filter.authors.some((prefix) => event.pubkey.startsWith(prefix))) {
      return false
    }
  }

  if (filter.kinds !== undefined) {
    if (!filter.kinds.includes(event.kind)) {
      return false
    }
  }

  if (filter.since !== undefined && event.created_at < filter.since) {
    return false
  }

  if (filter.until !== undefined && event.created_at > filter.until) {
    return false
  }

  for (const key of Object.keys(filter)) {
    if (!key.startsWith('#')) continue
    const tagName = key.slice(1)
    const wanted = filter[key] as string[]
    const hasMatch = event.tags.some(
      (tag) => tag[0] === tagName && wanted.includes(tag[1])
    )
    if (!hasMatch) return false
  }

  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/nostr/filter.test.ts
```

Expected: PASS (17 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/nostr/filter.ts src/core/nostr/filter.test.ts
git commit -m "feat: add NostrFilter type and matchesFilter()"
```

---

### Task 5: `src/core/identity/keys.ts` — Key generation

**Files:**
- Create: `src/core/identity/keys.ts`
- Create: `src/core/identity/keys.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/identity/keys.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generateKeypair, pubkeyFromPrivkey, keypairFromHex } from './keys.js'

describe('generateKeypair', () => {
  it('returns 64-char lowercase hex privkey and pubkey', () => {
    const kp = generateKeypair()
    expect(kp.privkey).toMatch(/^[0-9a-f]{64}$/)
    expect(kp.pubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique keypairs each call', () => {
    const a = generateKeypair()
    const b = generateKeypair()
    expect(a.privkey).not.toBe(b.privkey)
    expect(a.pubkey).not.toBe(b.pubkey)
  })
})

describe('pubkeyFromPrivkey', () => {
  it('is deterministic for the same private key', () => {
    const kp = generateKeypair()
    expect(pubkeyFromPrivkey(kp.privkey)).toBe(kp.pubkey)
  })

  it('returns 64-char lowercase hex', () => {
    const kp = generateKeypair()
    expect(pubkeyFromPrivkey(kp.privkey)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('keypairFromHex', () => {
  it('round-trips a stored private key', () => {
    const original = generateKeypair()
    const restored = keypairFromHex(original.privkey)
    expect(restored.privkey).toBe(original.privkey)
    expect(restored.pubkey).toBe(original.pubkey)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/identity/keys.test.ts
```

Expected: FAIL — cannot find module `./keys.js`

- [ ] **Step 3: Write the implementation**

Create `src/core/identity/keys.ts`:

```ts
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

export interface Keypair {
  privkey: string  // 32-byte hex (64 chars), lowercase
  pubkey: string   // 32-byte x-only secp256k1 hex (64 chars), lowercase
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function generateKeypair(): Keypair {
  const privkeyBytes = generateSecretKey()
  const privkey = bytesToHex(privkeyBytes)
  const pubkey = getPublicKey(privkeyBytes)
  return { privkey, pubkey }
}

export function pubkeyFromPrivkey(privkeyHex: string): string {
  return getPublicKey(hexToBytes(privkeyHex))
}

export function keypairFromHex(privkeyHex: string): Keypair {
  return {
    privkey: privkeyHex,
    pubkey: pubkeyFromPrivkey(privkeyHex),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/identity/keys.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/identity/keys.ts src/core/identity/keys.test.ts
git commit -m "feat: add Keypair type and key generation helpers"
```

---

### Task 6: `src/core/identity/signing.ts` — Event signing and `signAnnouncement`

**Files:**
- Create: `src/core/identity/signing.ts`
- Create: `src/core/identity/signing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/identity/signing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { eventId, signEvent, verifyEvent, signAnnouncement } from './signing.js'
import { generateKeypair } from './keys.js'
import { isSignedEvent, type NostrEvent } from '../nostr/event.js'
import { buildAnnouncement } from '../protocol/announcement.js'

function makeUnsigned(pubkey: string): NostrEvent {
  return {
    kind: 1,
    pubkey,
    created_at: 1700000000,
    tags: [],
    content: 'hello',
    sig: '',
  }
}

describe('eventId', () => {
  it('returns a 64-char lowercase hex string', () => {
    const kp = generateKeypair()
    const id = eventId(makeUnsigned(kp.pubkey))
    expect(id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same event', () => {
    const kp = generateKeypair()
    const ev = makeUnsigned(kp.pubkey)
    expect(eventId(ev)).toBe(eventId(ev))
  })
})

describe('signEvent', () => {
  it('produces a SignedNostrEvent with valid id and sig', () => {
    const kp = generateKeypair()
    const signed = signEvent(makeUnsigned(kp.pubkey), kp.privkey)
    expect(isSignedEvent(signed)).toBe(true)
    expect(signed.id).toMatch(/^[0-9a-f]{64}$/)
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/)
  })

  it('throws for invalid privkey', () => {
    const kp = generateKeypair()
    expect(() => signEvent(makeUnsigned(kp.pubkey), 'tooshort')).toThrow()
  })
})

describe('verifyEvent', () => {
  it('returns true for a correctly signed event', () => {
    const kp = generateKeypair()
    const signed = signEvent(makeUnsigned(kp.pubkey), kp.privkey)
    expect(verifyEvent(signed)).toBe(true)
  })

  it('returns false for a tampered event', () => {
    const kp = generateKeypair()
    const signed = signEvent(makeUnsigned(kp.pubkey), kp.privkey)
    const tampered = { ...signed, content: 'tampered' }
    expect(verifyEvent(tampered)).toBe(false)
  })
})

describe('signAnnouncement', () => {
  it('produces a SignedNostrEvent with kind 10800', () => {
    const kp = generateKeypair()
    const ann = buildAnnouncement({
      pubkey: kp.pubkey,
      qkey: 'mykey',
      hash: 'deadbeef',
      sizeBytes: 1024,
      pieces: 4,
      pieceSize: 256,
      ttl: 3600,
    })
    const signed = signAnnouncement(ann, kp.privkey)
    expect(signed.kind).toBe(10800)
    expect(isSignedEvent(signed)).toBe(true)
    expect(verifyEvent(signed)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/identity/signing.test.ts
```

Expected: FAIL — cannot find module `./signing.js`

- [ ] **Step 3: Write the implementation**

Create `src/core/identity/signing.ts`:

```ts
import { finalizeEvent, verifyEvent as ntVerifyEvent, getEventHash } from 'nostr-tools/pure'
import { type NostrEvent, type SignedNostrEvent } from '../nostr/event.js'
import { type QDHTAnnouncement } from '../protocol/announcement.js'

function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64) {
    throw new Error(`privkey must be 64 hex chars, got ${hex.length}`)
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function eventId(event: NostrEvent): string {
  return getEventHash({
    kind: event.kind,
    pubkey: event.pubkey,
    created_at: event.created_at,
    tags: event.tags,
    content: event.content,
  })
}

export function signEvent(event: NostrEvent, privkeyHex: string): SignedNostrEvent {
  const privkeyBytes = hexToBytes(privkeyHex)
  const finalized = finalizeEvent(
    {
      kind: event.kind,
      pubkey: event.pubkey,
      created_at: event.created_at,
      tags: event.tags,
      content: event.content,
    },
    privkeyBytes,
  )
  return {
    kind: finalized.kind,
    pubkey: finalized.pubkey,
    created_at: finalized.created_at,
    tags: finalized.tags,
    content: finalized.content,
    id: finalized.id,
    sig: finalized.sig,
  }
}

export function verifyEvent(event: SignedNostrEvent): boolean {
  try {
    return ntVerifyEvent(event as Parameters<typeof ntVerifyEvent>[0])
  } catch {
    return false
  }
}

export function signAnnouncement(
  ann: QDHTAnnouncement,
  privkeyHex: string,
): SignedNostrEvent {
  const event: NostrEvent = {
    kind: ann.kind,
    pubkey: ann.pubkey,
    created_at: ann.created_at,
    tags: ann.tags,
    content: ann.content,
    sig: '',
  }
  return signEvent(event, privkeyHex)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/identity/signing.test.ts
```

Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/identity/signing.ts src/core/identity/signing.test.ts
git commit -m "feat: add eventId, signEvent, verifyEvent, signAnnouncement"
```

---

### Task 7: `src/core/identity/encryption.ts` — NIP-44 encrypt/decrypt

**Files:**
- Create: `src/core/identity/encryption.ts`
- Create: `src/core/identity/encryption.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/identity/encryption.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from './encryption.js'
import { generateKeypair } from './keys.js'

describe('encrypt / decrypt', () => {
  it('round-trips a plaintext message', () => {
    const sender = generateKeypair()
    const recipient = generateKeypair()
    const plaintext = 'hello qDHT'

    const ciphertext = encrypt(plaintext, sender.privkey, recipient.pubkey)
    const decrypted = decrypt(ciphertext, recipient.privkey, sender.pubkey)

    expect(decrypted).toBe(plaintext)
  })

  it('produces different ciphertext each call (random nonce)', () => {
    const sender = generateKeypair()
    const recipient = generateKeypair()
    const a = encrypt('same', sender.privkey, recipient.pubkey)
    const b = encrypt('same', sender.privkey, recipient.pubkey)
    expect(a).not.toBe(b)
  })

  it('throws when decrypting with wrong recipient key', () => {
    const sender = generateKeypair()
    const recipient = generateKeypair()
    const wrong = generateKeypair()

    const ciphertext = encrypt('secret', sender.privkey, recipient.pubkey)
    expect(() => decrypt(ciphertext, wrong.privkey, sender.pubkey)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/identity/encryption.test.ts
```

Expected: FAIL — cannot find module `./encryption.js`

- [ ] **Step 3: Write the implementation**

Create `src/core/identity/encryption.ts`:

```ts
import { encrypt as nip44Encrypt, decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44'

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function encrypt(
  plaintext: string,
  senderPrivkeyHex: string,
  recipientPubkeyHex: string,
): string {
  const conversationKey = getConversationKey(
    hexToBytes(senderPrivkeyHex),
    recipientPubkeyHex,
  )
  return nip44Encrypt(plaintext, conversationKey)
}

export function decrypt(
  ciphertext: string,
  recipientPrivkeyHex: string,
  senderPubkeyHex: string,
): string {
  const conversationKey = getConversationKey(
    hexToBytes(recipientPrivkeyHex),
    senderPubkeyHex,
  )
  return nip44Decrypt(ciphertext, conversationKey)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/identity/encryption.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/identity/encryption.ts src/core/identity/encryption.test.ts
git commit -m "feat: add NIP-44 encrypt/decrypt wrappers"
```

---

### Task 8: Full test suite verification

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass, including Phase 1 tests (no regressions). You should see roughly 40+ tests across all files.

- [ ] **Step 2: Type-check the whole project**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit if any minor fixes were needed**

If `npm run build` revealed type errors, fix them, then:

```bash
git add -p
git commit -m "fix: resolve TypeScript type errors in Phase 2 modules"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| `generateKeypair`, `pubkeyFromPrivkey`, `keypairFromHex` | Task 5 |
| `signEvent`, `verifyEvent`, `eventId` | Task 6 |
| `signAnnouncement(ann, privkey)` bridge helper | Task 6 |
| NIP-44 `encrypt` / `decrypt` | Task 7 |
| `NostrEvent`, `SignedNostrEvent`, `isSignedEvent()` | Task 1 |
| `QDHT_KIND` enum, `isQDHTKind()` | Task 2 |
| `getTag`, `getTags`, `hasTag`, `buildTagMap` | Task 3 |
| `NostrFilter`, `matchesFilter()` | Task 4 |
| Install `nostr-tools` | Task 0 |
| Phase 1 files unchanged | Tasks do not touch `src/core/protocol/` |
| Sim continues with `sig: ''` | Not touched — no task required |

All requirements covered. No gaps found.

### Type consistency check

- `NostrEvent` defined in Task 1, imported in Tasks 4, 6 — same shape throughout.
- `SignedNostrEvent` defined in Task 1, returned by `signEvent` and `signAnnouncement` in Task 6 — consistent.
- `Keypair` defined in Task 5, used only within `keys.ts` and consumed by tests — consistent.
- `QDHTAnnouncement` imported from Phase 1 `announcement.ts` in Task 6 — shape matches (kind, pubkey, created_at, tags, content, sig).
- `hexToBytes` is private and duplicated in `keys.ts`, `signing.ts`, and `encryption.ts` — intentional (no cross-module dependency between identity subfiles). Each is a 5-line helper.
