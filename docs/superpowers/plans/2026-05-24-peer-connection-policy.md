# Peer Connection Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate outbound peer connections triggered by kind `30181` SERVICE_RECORD events behind a `PeerDiscoveryPolicy` that enforces peer-cap, URL dedup, and reputation threshold checks.

**Architecture:** A new stateless `DefaultPeerDiscoveryPolicy` class owns all connection-gating logic and is called by `SyncManager` when it receives a kind `30181` event. `SyncManager` gains a `case 30181` handler and receives `PeerDiscoveryPolicy`, `PeerManager`, `maxPeers`, and `listenAddress` via its constructor options. `QDHTNode` wires everything together — no new config fields are needed.

**Tech Stack:** TypeScript, Vitest, existing `PeerInfo` / `ReputationMap` / `QDHTConfig` types.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/node/peer-discovery-policy.ts` | **Create** | `ServiceRecord` interface, `PeerDiscoveryPolicy` interface, `DefaultPeerDiscoveryPolicy` class, `REPUTATION_CONNECT_THRESHOLD` constant |
| `src/node/peer-discovery-policy.test.ts` | **Create** | Unit tests for `DefaultPeerDiscoveryPolicy` |
| `src/node/sync-manager.ts` | **Modify** | Add `peerManager`, `peerDiscoveryPolicy`, `maxPeers`, `ownPubkey`, `ownUrl`, `bootstrapMode` to `SyncManagerOptions`; add `case 30181` handler |
| `src/node/sync-manager.test.ts` | **Modify** | Tests for kind `30181` handling: happy path, self-connect guard, cap guard, reputation gate, bootstrap skip, malformed URL |
| `src/node/qdht-node.ts` | **Modify** | Pass `peerManager`, `peerDiscoveryPolicy`, `maxPeers`, `listenAddress`, `bootstrapMode` into `SyncManager` constructor |

---

## Task 1: Create `peer-discovery-policy.ts` with types and constant

**Files:**
- Create: `src/node/peer-discovery-policy.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/node/peer-discovery-policy.ts
import type { PeerInfo } from './peer-manager.js'
import type { ReputationMap } from '../core/protocol/reputation.js'

export const REPUTATION_CONNECT_THRESHOLD = -0.3

export interface ServiceRecord {
  url: string
  advertiserPubkey: string
}

export interface PeerDiscoveryPolicy {
  shouldConnect(
    record: ServiceRecord,
    currentPeers: PeerInfo[],
    reputationMap: ReputationMap,
    maxPeers: number,
  ): boolean
}

export class DefaultPeerDiscoveryPolicy implements PeerDiscoveryPolicy {
  shouldConnect(
    record: ServiceRecord,
    currentPeers: PeerInfo[],
    reputationMap: ReputationMap,
    maxPeers: number,
  ): boolean {
    if (currentPeers.length >= maxPeers) {
      return false
    }
    if (currentPeers.some((p) => p.url === record.url)) {
      return false
    }
    if (reputationMap.get(record.advertiserPubkey) < REPUTATION_CONNECT_THRESHOLD) {
      return false
    }
    return true
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/mattthomson/workspace/qDHT && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only pre-existing errors unrelated to this file).

- [ ] **Step 3: Commit**

```bash
git add src/node/peer-discovery-policy.ts
git commit -m "feat: add PeerDiscoveryPolicy interface and DefaultPeerDiscoveryPolicy"
```

---

## Task 2: Unit-test `DefaultPeerDiscoveryPolicy`

**Files:**
- Create: `src/node/peer-discovery-policy.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/node/peer-discovery-policy.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { DefaultPeerDiscoveryPolicy, REPUTATION_CONNECT_THRESHOLD } from './peer-discovery-policy.js'
import { ReputationMap } from '../core/protocol/reputation.js'
import type { PeerInfo } from './peer-manager.js'

function makePeer(url: string, pubkey = 'aabbcc'): PeerInfo {
  return { pubkey, url, latencyMs: null, connectedAt: new Date().toISOString() }
}

describe('DefaultPeerDiscoveryPolicy', () => {
  let policy: DefaultPeerDiscoveryPolicy
  let reputation: ReputationMap

  beforeEach(() => {
    policy = new DefaultPeerDiscoveryPolicy()
    reputation = new ReputationMap()
  })

  it('returns true when all gates pass', () => {
    const result = policy.shouldConnect(
      { url: 'ws://peer1:7777', advertiserPubkey: 'pubkey1' },
      [],
      reputation,
      50,
    )
    expect(result).toBe(true)
  })

  it('returns false when peer cap is reached', () => {
    const peers = Array.from({ length: 50 }, (_, i) => makePeer(`ws://peer${i}:7777`))
    const result = policy.shouldConnect(
      { url: 'ws://newpeer:7777', advertiserPubkey: 'pubkey1' },
      peers,
      reputation,
      50,
    )
    expect(result).toBe(false)
  })

  it('returns false when URL is already in currentPeers', () => {
    const result = policy.shouldConnect(
      { url: 'ws://peer1:7777', advertiserPubkey: 'pubkey1' },
      [makePeer('ws://peer1:7777')],
      reputation,
      50,
    )
    expect(result).toBe(false)
  })

  it('returns false when reputation is below threshold', () => {
    reputation.set('badpeer', REPUTATION_CONNECT_THRESHOLD - 0.01)
    const result = policy.shouldConnect(
      { url: 'ws://peer1:7777', advertiserPubkey: 'badpeer' },
      [],
      reputation,
      50,
    )
    expect(result).toBe(false)
  })

  it('returns true when reputation equals threshold (boundary)', () => {
    reputation.set('borderline', REPUTATION_CONNECT_THRESHOLD)
    const result = policy.shouldConnect(
      { url: 'ws://peer1:7777', advertiserPubkey: 'borderline' },
      [],
      reputation,
      50,
    )
    expect(result).toBe(true)
  })

  it('returns true for unknown peer (default reputation 0 is above threshold)', () => {
    const result = policy.shouldConnect(
      { url: 'ws://unknown:7777', advertiserPubkey: 'unknownpubkey' },
      [],
      reputation,
      50,
    )
    expect(result).toBe(true)
  })

  it('checks gates in order: cap before URL dedup', () => {
    // Cap is reached AND URL already present — cap fires first, still false
    const peers = Array.from({ length: 50 }, (_, i) => makePeer(`ws://peer${i}:7777`))
    const result = policy.shouldConnect(
      { url: 'ws://peer0:7777', advertiserPubkey: 'pubkey1' },
      peers,
      reputation,
      50,
    )
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/peer-discovery-policy.test.ts 2>&1
```

Expected: tests fail because the import resolves but vitest may fail on missing `.js` extensions or because we haven't wired yet. If tests pass already (all logic is in the file from Task 1), that is also fine — proceed.

- [ ] **Step 3: Run tests and confirm they pass**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/peer-discovery-policy.test.ts 2>&1
```

Expected: all 7 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/node/peer-discovery-policy.test.ts
git commit -m "test: unit tests for DefaultPeerDiscoveryPolicy"
```

---

## Task 3: Extend `SyncManagerOptions` and add kind `30181` handler

**Files:**
- Modify: `src/node/sync-manager.ts`

The existing `SyncManagerOptions` interface starts at line 15. The `handleMessage` switch starts at line 73. We add five new optional fields to the options and a new `case 30181` branch.

- [ ] **Step 1: Extend `SyncManagerOptions`**

Find the existing interface in `src/node/sync-manager.ts`:

```typescript
export interface SyncManagerOptions {
  pubkey: string
  privkey: string
  propagator: Propagator
  neighbourState: NeighbourStateMap
  reputationMap: ReputationMap
  eventStore: NostrEventRepository
  ownsEventStore?: boolean
  transports: Transport[]
}
```

Replace it with:

```typescript
export interface SyncManagerOptions {
  pubkey: string
  privkey: string
  propagator: Propagator
  neighbourState: NeighbourStateMap
  reputationMap: ReputationMap
  eventStore: NostrEventRepository
  ownsEventStore?: boolean
  transports: Transport[]
  // Peer connection gating (optional — omit in bootstrap mode)
  peerManager?: import('./peer-manager.js').PeerManager
  peerDiscoveryPolicy?: import('./peer-discovery-policy.js').PeerDiscoveryPolicy
  maxPeers?: number
  ownUrl?: string        // config.listenAddress — used for self-connect prevention
  bootstrapMode?: boolean
}
```

- [ ] **Step 2: Add the `case 30181` handler to `handleMessage`**

Find the existing switch block ending with `case 20801`. Add the new case **before** the closing `}` of the switch:

```typescript
      case 30181: {
        if (this.opts.bootstrapMode) break
        const pm = this.opts.peerManager
        const policy = this.opts.peerDiscoveryPolicy
        const maxPeers = this.opts.maxPeers
        if (!pm || !policy || maxPeers === undefined) break
        const urlTag = event.tags.find((t) => t[0] === 'url')
        if (!urlTag?.[1]) break
        let url: string
        try {
          url = new URL(urlTag[1]).toString()
        } catch {
          break // malformed URL — skip silently
        }
        if (url === this.opts.ownUrl || event.pubkey === this.opts.pubkey) break
        const record: import('./peer-discovery-policy.js').ServiceRecord = {
          url,
          advertiserPubkey: event.pubkey,
        }
        if (policy.shouldConnect(record, pm.peers(), this.opts.reputationMap, maxPeers)) {
          pm.connect(url)
        }
        break
      }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/mattthomson/workspace/qDHT && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 4: Run existing sync-manager tests to confirm nothing regressed**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/sync-manager.test.ts 2>&1
```

Expected: all existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/node/sync-manager.ts
git commit -m "feat: add kind 30181 handler to SyncManager with PeerDiscoveryPolicy gating"
```

---

## Task 4: Integration tests for kind `30181` in `SyncManager`

**Files:**
- Modify: `src/node/sync-manager.test.ts`

The existing test file uses a `makeMockTransport()` helper and imports `SyncManager`. We append new tests to the existing file. Read the file to find the last `describe` block and append after it. The helper types below are what the tests need.

- [ ] **Step 1: Append new describe block to `src/node/sync-manager.test.ts`**

Add this at the bottom of the file (after all existing `describe` blocks):

```typescript
// ---- kind 30181 (SERVICE_RECORD) tests ----

import { DefaultPeerDiscoveryPolicy } from './peer-discovery-policy.js'

function makeServiceRecordEvent(url: string, pubkey: string): Record<string, unknown> {
  return {
    kind: 30181,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['url', url]],
    content: '',
    sig: '',
  }
}

describe('SyncManager kind 30181 handling', () => {
  const PEER_PUBKEY = 'aa'.repeat(32)
  const OWN_PUBKEY = 'bb'.repeat(32)
  const OWN_URL = 'ws://self:7777/'

  function makePeerManagerStub() {
    const connected: string[] = []
    return {
      connected,
      peers: () => [] as import('./peer-manager.js').PeerInfo[],
      connect: (url: string) => { connected.push(url) },
    }
  }

  function makeSyncManager(
    transport: ReturnType<typeof makeMockTransport>,
    peerManager: ReturnType<typeof makePeerManagerStub>,
    options: { bootstrapMode?: boolean; ownUrl?: string } = {},
  ) {
    const graph = new GraphState()
    graph.addNode(OWN_PUBKEY)
    const propagator = new Propagator(graph, graph.getIndex(OWN_PUBKEY), 0.5)
    const rep = new ReputationMap()
    return new SyncManager({
      pubkey: OWN_PUBKEY,
      privkey: '00'.repeat(32),
      propagator,
      neighbourState: new NeighbourStateMap(),
      reputationMap: rep,
      eventStore: { loadAll: () => [], upsert: () => {}, close: () => {} } as unknown as import('../core/storage/event-repository.js').NostrEventRepository,
      transports: [transport],
      peerManager: peerManager as unknown as import('./peer-manager.js').PeerManager,
      peerDiscoveryPolicy: new DefaultPeerDiscoveryPolicy(),
      maxPeers: 50,
      ownUrl: options.ownUrl ?? OWN_URL,
      bootstrapMode: options.bootstrapMode,
    })
  }

  it('connects to a valid peer URL from a 30181 event', () => {
    const transport = makeMockTransport()
    const pm = makePeerManagerStub()
    const sm = makeSyncManager(transport, pm)

    transport.triggerMessage(makeServiceRecordEvent('ws://peer1:7777', PEER_PUBKEY), PEER_PUBKEY)

    expect(pm.connected).toContain('ws://peer1:7777/')
    sm.close()
  })

  it('does not connect when own pubkey is the advertiser', () => {
    const transport = makeMockTransport()
    const pm = makePeerManagerStub()
    const sm = makeSyncManager(transport, pm)

    transport.triggerMessage(makeServiceRecordEvent('ws://self:9999', OWN_PUBKEY), OWN_PUBKEY)

    expect(pm.connected).toHaveLength(0)
    sm.close()
  })

  it('does not connect when URL matches ownUrl', () => {
    const transport = makeMockTransport()
    const pm = makePeerManagerStub()
    const sm = makeSyncManager(transport, pm, { ownUrl: 'ws://self:7777/' })

    transport.triggerMessage(makeServiceRecordEvent('ws://self:7777', PEER_PUBKEY), PEER_PUBKEY)

    expect(pm.connected).toHaveLength(0)
    sm.close()
  })

  it('does not connect when bootstrapMode is true', () => {
    const transport = makeMockTransport()
    const pm = makePeerManagerStub()
    const sm = makeSyncManager(transport, pm, { bootstrapMode: true })

    transport.triggerMessage(makeServiceRecordEvent('ws://peer1:7777', PEER_PUBKEY), PEER_PUBKEY)

    expect(pm.connected).toHaveLength(0)
    sm.close()
  })

  it('does not connect when URL is malformed', () => {
    const transport = makeMockTransport()
    const pm = makePeerManagerStub()
    const sm = makeSyncManager(transport, pm)

    transport.triggerMessage(
      { kind: 30181, pubkey: PEER_PUBKEY, created_at: 0, tags: [['url', 'not a url !!!']], content: '', sig: '' },
      PEER_PUBKEY,
    )

    expect(pm.connected).toHaveLength(0)
    sm.close()
  })

  it('does not connect when url tag is absent', () => {
    const transport = makeMockTransport()
    const pm = makePeerManagerStub()
    const sm = makeSyncManager(transport, pm)

    transport.triggerMessage(
      { kind: 30181, pubkey: PEER_PUBKEY, created_at: 0, tags: [], content: '', sig: '' },
      PEER_PUBKEY,
    )

    expect(pm.connected).toHaveLength(0)
    sm.close()
  })
})
```

- [ ] **Step 2: Run the tests — expect them to fail**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/sync-manager.test.ts 2>&1 | tail -30
```

Expected: new `kind 30181 handling` tests fail because the `NostrEventRepository` stub is inline and may need minor adjustment, or because `makeSyncManager` references a missing import. Fix any import errors now — do not proceed until the test file compiles.

- [ ] **Step 3: Verify and fix imports at the top of the test file**

The new `describe` block needs `GraphState` and `Propagator`. These are already imported by the existing test file (verify with `grep "GraphState\|Propagator" src/node/sync-manager.test.ts`). If missing, add:

```typescript
import { GraphState } from '../core/graph/graph-state.js'
import { Propagator } from '../core/propagation/propagator.js'
```

- [ ] **Step 4: Run all sync-manager tests and confirm they pass**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/sync-manager.test.ts 2>&1
```

Expected: all tests (existing + new) PASS.

- [ ] **Step 5: Commit**

```bash
git add src/node/sync-manager.test.ts
git commit -m "test: kind 30181 handler integration tests in SyncManager"
```

---

## Task 5: Wire `PeerDiscoveryPolicy` in `QDHTNode`

**Files:**
- Modify: `src/node/qdht-node.ts`

`QDHTNode` constructs `SyncManager` at line 158. We pass the four new fields into the options object.

- [ ] **Step 1: Add import for `DefaultPeerDiscoveryPolicy`**

At the top of `src/node/qdht-node.ts`, add after the `PeerManager` import line:

```typescript
import { DefaultPeerDiscoveryPolicy } from './peer-discovery-policy.js'
```

- [ ] **Step 2: Update the `SyncManager` constructor call in `QDHTNode`**

Find the existing call (around line 158–166):

```typescript
      this.syncManager = new SyncManager({
        pubkey: this.kp.pubkey,
        privkey: this.kp.privkey,
        propagator: this.propagator,
        neighbourState: this.neighbourState,
        reputationMap: this.reputationMap,
        eventStore: this.storage.events,
        transports,
      })
```

Replace it with:

```typescript
      this.syncManager = new SyncManager({
        pubkey: this.kp.pubkey,
        privkey: this.kp.privkey,
        propagator: this.propagator,
        neighbourState: this.neighbourState,
        reputationMap: this.reputationMap,
        eventStore: this.storage.events,
        transports,
        peerManager: this.peerManager,
        peerDiscoveryPolicy: new DefaultPeerDiscoveryPolicy(),
        maxPeers: config.maxPeers ?? 50,
        ownUrl: config.listenAddress,
        bootstrapMode: config.bootstrapMode,
      })
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/mattthomson/workspace/qDHT && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 4: Run full test suite**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/qdht-node.ts
git commit -m "feat: wire DefaultPeerDiscoveryPolicy into QDHTNode → SyncManager"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|------------|
| `PeerDiscoveryPolicy` stateless class with `shouldConnect` | Task 1 |
| Gate 1: peer cap | Task 1 + Task 2 |
| Gate 2: URL dedup via `p.url` on `PeerInfo[]` | Task 1 + Task 2 |
| Gate 3: reputation threshold `-0.3` | Task 1 + Task 2 |
| `REPUTATION_CONNECT_THRESHOLD` constant in `peer-discovery-policy.ts` | Task 1 |
| Unknown node defaults to 0 (neutral → allowed) | Task 2 |
| `SyncManager` `case 30181` handler | Task 3 |
| `ownUrl` from `config.listenAddress` — no new constructor param | Task 3 + Task 5 |
| Self-connect guard (own pubkey OR own URL) | Task 3 + Task 4 |
| Bootstrap mode guard | Task 3 + Task 4 |
| Malformed URL silent skip | Task 3 + Task 4 |
| Missing `url` tag silent skip | Task 3 + Task 4 |
| `QDHTNode` wiring | Task 5 |

**Placeholder scan:** No TBD, TODO, "similar to", or vague steps present.

**Type consistency check:** `PeerInfo` is imported from `peer-manager.ts` in Task 1. `pm.peers()` returns `PeerInfo[]` (line 163 of `peer-manager.ts`). The stub in Task 4 types its return as `PeerInfo[]`. `ServiceRecord` is defined once in Task 1 and referenced by name in Task 3 (inline import) and Task 4 (via `DefaultPeerDiscoveryPolicy` which imports it). `REPUTATION_CONNECT_THRESHOLD` is exported once and imported in the test in Task 2. Consistent throughout.
