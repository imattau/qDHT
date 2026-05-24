# Bootstrap Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `bootstrapMode` to `QDHTNode` so a lightweight rendezvous node can help new peers discover each other by accumulating and redistributing kind `30181` (Service Record) events and reflecting each peer's public address back to them.

**Architecture:** `QDHTConfig` gains two optional fields (`bootstrapMode`, `maxPeers`). `QDHTNode` skips heavy subsystems (Propagator, ReplicaStore, ReputationMap, ContentProviderRegistry) when `bootstrapMode` is true. A new `BootstrapService` class owns the `30181` LRU cache, peer-connect fanout, disconnect eviction, expiry timer, and maxPeers enforcement. Normal nodes gain `30181` publishing on each peer-connect as a prerequisite step.

**Tech Stack:** TypeScript, Node.js, `ws` (WebSocket), `nostr-tools` (signing via `finalizeEvent`), `vitest`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/core/nostr/kinds.ts` | Modify | Add `NODE_PROFILE` (30180) and `SERVICE_RECORD` (30181) to `QDHT_KIND` and `QDHT_KIND_ROWS` |
| `src/node/config.ts` | Modify | Add `bootstrapMode?` and `maxPeers?` to `QDHTConfig` and `ConfigOverrides`; add validation |
| `src/node/peer-manager.ts` | Modify | Publish signed `30181` after peer handshake completes; accept optional `listenAddress` in options |
| `src/node/bootstrap-service.ts` | Create | Full `BootstrapService`: LRU cache, connect fanout, disconnect eviction, expiry timer, maxPeers enforcement, address reflection |
| `src/node/qdht-node.ts` | Modify | Guard heavy subsystems behind `if (!bootstrapMode)`; wire `BootstrapService` when in bootstrap mode; handle delta catch-up in bootstrap mode |
| `bin/qdht-node.ts` | Modify | Add `--bootstrap` and `--max-peers` CLI flags to `start` command |
| `src/core/nostr/kinds.test.ts` | Modify | Add assertions for new kind constants and rows |
| `src/node/config.test.ts` | Modify | Add tests for `bootstrapMode` and `maxPeers` validation |
| `src/node/peer-manager.test.ts` | Modify | Add test: `30181` is sent after handshake when `listenAddress` is configured |
| `src/node/bootstrap-service.test.ts` | Create | Unit tests for `BootstrapService` |

---

## Task 1: Add `NODE_PROFILE` and `SERVICE_RECORD` kinds

**Files:**
- Modify: `src/core/nostr/kinds.ts`
- Modify: `src/core/nostr/kinds.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/core/nostr/kinds.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { QDHT_KIND, QDHT_KIND_ROWS, NOSTR_KIND_ROWS } from './kinds.js'

describe('kinds', () => {
  it('defines NODE_PROFILE as 30180', () => {
    expect(QDHT_KIND.NODE_PROFILE).toBe(30180)
  })

  it('defines SERVICE_RECORD as 30181', () => {
    expect(QDHT_KIND.SERVICE_RECORD).toBe(30181)
  })

  it('includes node_profile row in QDHT_KIND_ROWS', () => {
    const row = QDHT_KIND_ROWS.find((r) => r.kind_id === 30180)
    expect(row).toBeDefined()
    expect(row?.name).toBe('node_profile')
    expect(row?.category).toBe('routing')
    expect(row?.searchable).toBe(1)
  })

  it('includes service_record row in QDHT_KIND_ROWS', () => {
    const row = QDHT_KIND_ROWS.find((r) => r.kind_id === 30181)
    expect(row).toBeDefined()
    expect(row?.name).toBe('service_record')
    expect(row?.category).toBe('routing')
    expect(row?.searchable).toBe(1)
  })

  it('includes both new kinds in NOSTR_KIND_ROWS', () => {
    const ids = NOSTR_KIND_ROWS.map((r) => r.kind_id)
    expect(ids).toContain(30180)
    expect(ids).toContain(30181)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/core/nostr/kinds.test.ts
```

Expected: FAIL — `QDHT_KIND.NODE_PROFILE` is undefined.

- [ ] **Step 3: Implement the changes**

In `src/core/nostr/kinds.ts`, update `QDHT_KIND`:

```typescript
export const QDHT_KIND = {
  ANNOUNCEMENT: 10800,
  REPLICA_RECORD: 10801,
  REPUTATION_DELTA: 10802,
  PIECE_MANIFEST: 10803,
  REQUEST_ANNOUNCEMENT: 10804,
  REQUEST_RESPONSE: 10805,
  DELTA_REQUEST: 20800,
  DELTA_RESPONSE: 20801,
  NODE_PROFILE: 30180,
  SERVICE_RECORD: 30181,
} as const
```

Add two rows to `QDHT_KIND_ROWS` (before the closing bracket):

```typescript
  { kind_id: QDHT_KIND.NODE_PROFILE,   name: 'node_profile',   category: 'routing', searchable: 1, description: 'Node capability profile' },
  { kind_id: QDHT_KIND.SERVICE_RECORD, name: 'service_record', category: 'routing', searchable: 1, description: 'Peer endpoint and transport info' },
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/core/nostr/kinds.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/nostr/kinds.ts src/core/nostr/kinds.test.ts
git commit -m "feat: add NODE_PROFILE (30180) and SERVICE_RECORD (30181) kind constants"
```

---

## Task 2: Extend `QDHTConfig` with `bootstrapMode` and `maxPeers`

**Files:**
- Modify: `src/node/config.ts`
- Modify: `src/node/config.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/node/config.test.ts`:

```typescript
describe('bootstrapMode and maxPeers', () => {
  it('accepts bootstrapMode: true without maxPeers', async () => {
    const cfg = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: tmpDir,
      bootstrapMode: true,
    }
    await writeFile(join(tmpDir, 'cfg-bsm.json'), JSON.stringify(cfg))
    const loaded = await loadConfig(join(tmpDir, 'cfg-bsm.json'))
    expect(loaded.bootstrapMode).toBe(true)
    expect(loaded.maxPeers).toBeUndefined()
  })

  it('accepts maxPeers as a positive integer', async () => {
    const cfg = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: tmpDir,
      bootstrapMode: true,
      maxPeers: 500,
    }
    await writeFile(join(tmpDir, 'cfg-mp.json'), JSON.stringify(cfg))
    const loaded = await loadConfig(join(tmpDir, 'cfg-mp.json'))
    expect(loaded.maxPeers).toBe(500)
  })

  it('throws on maxPeers: 0', async () => {
    const cfg = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: tmpDir,
      maxPeers: 0,
    }
    await writeFile(join(tmpDir, 'cfg-mp0.json'), JSON.stringify(cfg))
    await expect(loadConfig(join(tmpDir, 'cfg-mp0.json'))).rejects.toThrow('maxPeers')
  })

  it('throws on maxPeers: 1.5 (non-integer)', async () => {
    const cfg = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: tmpDir,
      maxPeers: 1.5,
    }
    await writeFile(join(tmpDir, 'cfg-mpf.json'), JSON.stringify(cfg))
    await expect(loadConfig(join(tmpDir, 'cfg-mpf.json'))).rejects.toThrow('maxPeers')
  })

  it('applies bootstrapMode override from ConfigOverrides', async () => {
    const cfg = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: tmpDir,
    }
    await writeFile(join(tmpDir, 'cfg-bsov.json'), JSON.stringify(cfg))
    const loaded = await loadConfig(join(tmpDir, 'cfg-bsov.json'), { bootstrapMode: true, maxPeers: 100 })
    expect(loaded.bootstrapMode).toBe(true)
    expect(loaded.maxPeers).toBe(100)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/config.test.ts
```

Expected: FAIL — `bootstrapMode` field unknown on config.

- [ ] **Step 3: Implement the changes**

In `src/node/config.ts`, update both interfaces and `validateConfig` and `loadConfig`:

```typescript
export interface QDHTConfig {
  identity: { privkey: string }
  peers: string[]
  relays?: string[]
  nip96Servers?: string[]
  quicPeers?: string[]
  quicListenPort?: number
  webPort?: number
  port: number
  dataDir: string
  bootstrapMode?: boolean
  maxPeers?: number
  listenAddress?: string
}

export interface ConfigOverrides {
  port?: number
  peers?: string[]
  relays?: string[]
  nip96Servers?: string[]
  quicPeers?: string[]
  quicListenPort?: number
  webPort?: number
  dataDir?: string
  bootstrapMode?: boolean
  maxPeers?: number
  listenAddress?: string
}
```

In `validateConfig`, after the `webPort` block, add:

```typescript
  const bootstrapMode = candidate.bootstrapMode
  if (bootstrapMode !== undefined && typeof bootstrapMode !== 'boolean') {
    throw new Error('Config bootstrapMode must be a boolean')
  }

  const maxPeers = candidate.maxPeers
  if (maxPeers !== undefined) {
    if (typeof maxPeers !== 'number' || !Number.isInteger(maxPeers) || maxPeers <= 0) {
      throw new Error('Config maxPeers must be a positive integer')
    }
  }

  const listenAddress = candidate.listenAddress
  if (listenAddress !== undefined && typeof listenAddress !== 'string') {
    throw new Error('Config listenAddress must be a string')
  }
```

Add the three new fields to the `return` block:

```typescript
  return {
    identity: { privkey: validatePrivkey((identity as Record<string, unknown>).privkey) },
    peers,
    relays,
    nip96Servers,
    quicPeers,
    quicListenPort,
    webPort,
    port,
    dataDir,
    bootstrapMode: bootstrapMode as boolean | undefined,
    maxPeers: maxPeers as number | undefined,
    listenAddress: listenAddress as string | undefined,
  }
```

In `loadConfig`, after the existing override blocks, add:

```typescript
  if (overrides.bootstrapMode !== undefined) config.bootstrapMode = overrides.bootstrapMode
  if (overrides.maxPeers !== undefined) config.maxPeers = overrides.maxPeers
  if (overrides.listenAddress !== undefined) config.listenAddress = overrides.listenAddress
```

- [ ] **Step 4: Run tests**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/config.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/config.ts src/node/config.test.ts
git commit -m "feat: add bootstrapMode, maxPeers, and listenAddress to QDHTConfig"
```

---

## Task 3: Publish `30181` on peer handshake in `PeerManager`

**Files:**
- Modify: `src/node/peer-manager.ts`
- Modify: `src/node/peer-manager.test.ts`

The `PeerManager` needs to sign and send a `30181` event after a peer handshake resolves. The hook point is `registerPeerPubkey` — that fires once the remote peer's pubkey is known, i.e. the handshake is complete.

- [ ] **Step 1: Write the failing test**

Append to `src/node/peer-manager.test.ts`:

```typescript
import { WebSocket, WebSocketServer } from 'ws'
import { PeerManager } from './peer-manager.js'

// Add inside describe('PeerManager'):
  it('sends a kind 30181 event after handshake when listenAddress is set', async () => {
    const p = nextPort()
    pm = new PeerManager({
      port: p,
      pubkey: 'a'.repeat(64),
      privkey: 'a'.repeat(64),
      listenAddress: `ws://127.0.0.1:${p}`,
    })
    await pm.listen()

    const received: unknown[] = []
    const client = new WebSocket(`ws://127.0.0.1:${p}`)
    client.on('message', (data: import('ws').RawData) => {
      received.push(JSON.parse(data.toString()))
    })

    // Send handshake so PeerManager fires registerPeerPubkey
    await new Promise<void>((resolve) => {
      client.on('open', () => {
        client.send(JSON.stringify({ type: 'handshake', pubkey: 'b'.repeat(64) }))
        resolve()
      })
    })

    await waitFor(() => received.length >= 2) // handshake response + 30181

    const serviceRecord = (received as Array<Record<string, unknown>>).find(
      (m) => m.kind === 30181,
    )
    expect(serviceRecord).toBeDefined()
    expect((serviceRecord as Record<string, unknown>).pubkey).toBe('a'.repeat(64))

    const tags = (serviceRecord as Record<string, unknown>).tags as string[][]
    expect(tags.some(([k, v]) => k === 'url' && v === `ws://127.0.0.1:${p}`)).toBe(true)
    expect(tags.some(([k, v]) => k === 'd' && v === 'main')).toBe(true)
    expect(tags.some(([k]) => k === 'transport')).toBe(true)
    safeClose(client)
  })

  it('does not send 30181 when listenAddress is not set', async () => {
    const p = nextPort()
    pm = new PeerManager({ port: p, pubkey: 'c'.repeat(64), privkey: 'c'.repeat(64) })
    await pm.listen()

    const received: unknown[] = []
    const client = new WebSocket(`ws://127.0.0.1:${p}`)
    client.on('message', (data: import('ws').RawData) => {
      received.push(JSON.parse(data.toString()))
    })

    await new Promise<void>((resolve) => {
      client.on('open', () => {
        client.send(JSON.stringify({ type: 'handshake', pubkey: 'd'.repeat(64) }))
        resolve()
      })
    })

    // Give it a moment and confirm no 30181
    await new Promise((resolve) => setTimeout(resolve, 100))
    const serviceRecord = (received as Array<Record<string, unknown>>).find(
      (m) => m.kind === 30181,
    )
    expect(serviceRecord).toBeUndefined()
    safeClose(client)
  })
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/peer-manager.test.ts
```

Expected: FAIL — `PeerManagerOptions` does not accept `listenAddress`.

- [ ] **Step 3: Implement the changes**

Add the import at the top of `src/node/peer-manager.ts`:

```typescript
import { signEvent } from '../core/identity/signing.js'
import { QDHT_KIND } from '../core/nostr/kinds.js'
```

Add `listenAddress?: string` to `PeerManagerOptions`:

```typescript
export interface PeerManagerOptions {
  port: number
  pubkey: string
  privkey: string
  listenAddress?: string
}
```

Add a private method `sendServiceRecord` to `PeerManager`:

```typescript
  private sendServiceRecord(peer: ConnectedPeer): void {
    if (!this.opts.listenAddress) {
      return
    }
    const now = Math.floor(Date.now() / 1000)
    const event = signEvent(
      {
        kind: QDHT_KIND.SERVICE_RECORD,
        pubkey: this.opts.pubkey,
        created_at: now,
        tags: [
          ['transport', 'ws'],
          ['d', 'main'],
          ['url', this.opts.listenAddress],
        ],
        content: '',
        sig: '',
      },
      this.opts.privkey,
    )
    if (peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(JSON.stringify(event))
    }
  }
```

In `registerPeerPubkey`, at the end of the method (after `notifyConnected`), call:

```typescript
    this.sendServiceRecord(peer)
```

- [ ] **Step 4: Run tests**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/peer-manager.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/peer-manager.ts src/node/peer-manager.test.ts
git commit -m "feat: publish signed 30181 service record after peer handshake"
```

---

## Task 4: Create `BootstrapService`

**Files:**
- Create: `src/node/bootstrap-service.ts`
- Create: `src/node/bootstrap-service.test.ts`

`BootstrapService` owns the `30181` cache, fanout, eviction, and address reflection. It receives events via its `handleEvent` method, which callers invoke when a peer sends a message. It hooks into `PeerManager` callbacks for connect/disconnect.

- [ ] **Step 1: Write the failing tests**

Create `src/node/bootstrap-service.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { BootstrapService } from './bootstrap-service.js'
import { generateKeypair } from '../core/identity/keys.js'
import { signEvent } from '../core/identity/signing.js'
import { QDHT_KIND } from '../core/nostr/kinds.js'
import getPort from 'get-port'
import type { SignedNostrEvent } from '../core/nostr/event.js'

function makeServiceRecord(pubkey: string, privkey: string, url: string, createdAt?: number): SignedNostrEvent {
  return signEvent(
    {
      kind: QDHT_KIND.SERVICE_RECORD,
      pubkey,
      created_at: createdAt ?? Math.floor(Date.now() / 1000),
      tags: [['transport', 'ws'], ['d', 'main'], ['url', url]],
      content: '',
      sig: '',
    },
    privkey,
  )
}

describe('BootstrapService', () => {
  let svc: BootstrapService
  let nodeKp: { pubkey: string; privkey: string }

  beforeEach(() => {
    nodeKp = generateKeypair()
    svc = new BootstrapService({ pubkey: nodeKp.pubkey, privkey: nodeKp.privkey, maxPeers: 10 })
  })

  afterEach(() => {
    svc.stop()
  })

  it('caches a valid 30181 event', () => {
    const peer = generateKeypair()
    const event = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:7777')
    const sent: unknown[] = []
    svc.handleEvent(event, peer.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(1)
  })

  it('discards an event with invalid signature', () => {
    const peer = generateKeypair()
    const event = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:7777')
    // Tamper with sig
    const tampered = { ...event, sig: 'f'.repeat(128) }
    const sent: unknown[] = []
    svc.handleEvent(tampered, peer.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(0)
  })

  it('discards own pubkey event', () => {
    const event = makeServiceRecord(nodeKp.pubkey, nodeKp.privkey, 'ws://self:7777')
    const sent: unknown[] = []
    svc.handleEvent(event, nodeKp.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(0)
  })

  it('discards a stale replacement (older created_at)', () => {
    const peer = generateKeypair()
    const now = Math.floor(Date.now() / 1000)
    const newer = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:7777', now)
    const older = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:old', now - 60)
    const sent: unknown[] = []
    svc.handleEvent(newer, peer.pubkey, (msg) => sent.push(msg))
    svc.handleEvent(older, peer.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(1)
    // The cached URL should still be the newer one
  })

  it('accepts a strict replacement (newer created_at)', () => {
    const peer = generateKeypair()
    const now = Math.floor(Date.now() / 1000)
    const older = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:old', now - 60)
    const newer = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:new', now)
    const sent: unknown[] = []
    svc.handleEvent(older, peer.pubkey, (msg) => sent.push(msg))
    svc.handleEvent(newer, peer.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(1)
  })

  it('discards expired event on receipt', () => {
    const peer = generateKeypair()
    const now = Math.floor(Date.now() / 1000)
    const event = {
      ...makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:7777', now - 200),
    }
    // Manually add an expiration tag — re-sign so the event is valid
    const expired = signEvent(
      {
        kind: QDHT_KIND.SERVICE_RECORD,
        pubkey: peer.pubkey,
        created_at: now - 200,
        tags: [['transport', 'ws'], ['d', 'main'], ['url', 'ws://peer:7777'], ['expiration', '100']],
        content: '',
        sig: '',
      },
      peer.privkey,
    )
    const sent: unknown[] = []
    svc.handleEvent(expired, peer.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(0)
  })

  it('removes peer cache entry on disconnect', () => {
    const peer = generateKeypair()
    const event = makeServiceRecord(peer.pubkey, peer.privkey, 'ws://peer:7777')
    const sent: unknown[] = []
    svc.handleEvent(event, peer.pubkey, (msg) => sent.push(msg))
    expect(svc.cacheSize()).toBe(1)
    svc.onPeerDisconnected(peer.pubkey)
    expect(svc.cacheSize()).toBe(0)
  })

  it('sends cached entries to a newly connected peer', () => {
    const peer1 = generateKeypair()
    const peer2 = generateKeypair()
    const e1 = makeServiceRecord(peer1.pubkey, peer1.privkey, 'ws://peer1:7777')
    const sent1: unknown[] = []
    svc.handleEvent(e1, peer1.pubkey, (msg) => sent1.push(msg))

    // Now peer2 connects
    const sentToPeer2: unknown[] = []
    svc.onPeerConnected(peer2.pubkey, 'ws://127.0.0.1:9999', (msg) => sentToPeer2.push(msg))

    // peer2 should have received peer1's record
    const serviceRecords = (sentToPeer2 as Array<Record<string, unknown>>).filter(
      (m) => m.kind === QDHT_KIND.SERVICE_RECORD,
    )
    expect(serviceRecords.length).toBe(1)
    expect(serviceRecords[0].pubkey).toBe(peer1.pubkey)
  })

  it('sends observed_address (kind 30800) to newly connected peer', () => {
    const peer = generateKeypair()
    const sentToPeer: unknown[] = []
    svc.onPeerConnected(peer.pubkey, 'ws://203.0.113.5:54321', (msg) => sentToPeer.push(msg))

    const reflection = (sentToPeer as Array<Record<string, unknown>>).find(
      (m) => m.kind === 30800,
    )
    expect(reflection).toBeDefined()
    expect((reflection as Record<string, unknown>).content).toBe('203.0.113.5')
  })

  it('evicts oldest entry when cache is full', () => {
    svc = new BootstrapService({ pubkey: nodeKp.pubkey, privkey: nodeKp.privkey, maxPeers: 2 })
    const kp1 = generateKeypair()
    const kp2 = generateKeypair()
    const kp3 = generateKeypair()
    const now = Math.floor(Date.now() / 1000)
    const e1 = makeServiceRecord(kp1.pubkey, kp1.privkey, 'ws://p1:7777', now - 20)
    const e2 = makeServiceRecord(kp2.pubkey, kp2.privkey, 'ws://p2:7777', now - 10)
    const e3 = makeServiceRecord(kp3.pubkey, kp3.privkey, 'ws://p3:7777', now)
    svc.handleEvent(e1, kp1.pubkey, () => {})
    svc.handleEvent(e2, kp2.pubkey, () => {})
    svc.handleEvent(e3, kp3.pubkey, () => {})
    // kp1 was oldest; should have been evicted
    expect(svc.cacheSize()).toBe(2)
    expect(svc.hasCached(kp1.pubkey)).toBe(false)
    expect(svc.hasCached(kp2.pubkey)).toBe(true)
    expect(svc.hasCached(kp3.pubkey)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/bootstrap-service.test.ts
```

Expected: FAIL — module `bootstrap-service.js` not found.

- [ ] **Step 3: Implement `BootstrapService`**

Create `src/node/bootstrap-service.ts`:

```typescript
import { verifyEvent } from '../core/identity/signing.js'
import { signEvent } from '../core/identity/signing.js'
import { isSignedEvent } from '../core/nostr/event.js'
import { QDHT_KIND } from '../core/nostr/kinds.js'
import type { SignedNostrEvent } from '../core/nostr/event.js'

const DEFAULT_MAX_PEERS = 10_000
const EVICTION_INTERVAL_MS = 60_000

export interface BootstrapServiceOptions {
  pubkey: string
  privkey: string
  maxPeers?: number
}

type SendFn = (msg: unknown) => void

export class BootstrapService {
  private readonly pubkey: string
  private readonly privkey: string
  private readonly maxPeers: number
  private cache = new Map<string, SignedNostrEvent>()
  private evictionTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: BootstrapServiceOptions) {
    this.pubkey = opts.pubkey
    this.privkey = opts.privkey
    this.maxPeers = opts.maxPeers ?? DEFAULT_MAX_PEERS
    this.evictionTimer = setInterval(() => this.evictExpired(), EVICTION_INTERVAL_MS)
  }

  /** Call when a peer successfully completes a handshake and connects. */
  onPeerConnected(peerId: string, remoteAddress: string, send: SendFn): void {
    // Send all cached 30181 events to the new peer
    for (const event of this.cache.values()) {
      send(event)
    }
    // Reflect observed address via kind 30800
    const now = Math.floor(Date.now() / 1000)
    // Extract just the IP from "ws://IP:port" or raw "IP:port"
    const ip = this.extractIp(remoteAddress)
    const reflection = signEvent(
      {
        kind: 30800,
        pubkey: this.pubkey,
        created_at: now,
        tags: [['p', peerId]],
        content: ip,
        sig: '',
      },
      this.privkey,
    )
    send(reflection)
  }

  /** Call when a peer disconnects to remove their service record from the cache. */
  onPeerDisconnected(peerId: string): void {
    this.cache.delete(peerId)
  }

  /**
   * Process an incoming message from a peer.
   * @param event The parsed event object (any kind — non-30181 events are ignored).
   * @param fromPeerId The pubkey of the sending peer.
   * @param broadcast Called with each event that should be forwarded to all OTHER peers.
   */
  handleEvent(event: unknown, fromPeerId: string, broadcast: SendFn): void {
    if (!event || typeof event !== 'object') {
      return
    }
    const e = event as Record<string, unknown>
    if (e.kind !== QDHT_KIND.SERVICE_RECORD) {
      return
    }

    const candidate = event as SignedNostrEvent

    // Verify signature
    if (!isSignedEvent(candidate) || !verifyEvent(candidate)) {
      return
    }

    // Discard own pubkey
    if (candidate.pubkey === this.pubkey) {
      return
    }

    // Discard if expired
    if (this.isExpired(candidate)) {
      return
    }

    // Upsert: only accept if strictly newer
    const existing = this.cache.get(candidate.pubkey)
    if (existing && existing.created_at >= candidate.created_at) {
      return
    }

    // Evict oldest if at capacity (and this is a new pubkey, not an update)
    if (!existing && this.cache.size >= this.maxPeers) {
      this.evictOldest()
    }

    this.cache.set(candidate.pubkey, candidate)
    broadcast(candidate)
  }

  stop(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer)
      this.evictionTimer = null
    }
  }

  /** Test helpers */
  cacheSize(): number {
    return this.cache.size
  }

  hasCached(pubkey: string): boolean {
    return this.cache.has(pubkey)
  }

  private isExpired(event: SignedNostrEvent): boolean {
    const expirationTag = event.tags.find(([k]) => k === 'expiration')
    if (!expirationTag) {
      return false
    }
    const ttlSeconds = Number(expirationTag[1])
    if (!Number.isFinite(ttlSeconds)) {
      return false
    }
    const now = Math.floor(Date.now() / 1000)
    return event.created_at + ttlSeconds <= now
  }

  private evictExpired(): void {
    const now = Math.floor(Date.now() / 1000)
    for (const [pubkey, event] of this.cache) {
      if (this.isExpired(event)) {
        this.cache.delete(pubkey)
      }
    }
  }

  private evictOldest(): void {
    let oldestPubkey: string | null = null
    let oldestTime = Infinity
    for (const [pubkey, event] of this.cache) {
      if (event.created_at < oldestTime) {
        oldestTime = event.created_at
        oldestPubkey = pubkey
      }
    }
    if (oldestPubkey) {
      this.cache.delete(oldestPubkey)
    }
  }

  private extractIp(address: string): string {
    // address may be "ws://1.2.3.4:9999" or "::1" or "1.2.3.4:9999"
    try {
      if (address.startsWith('ws://') || address.startsWith('wss://')) {
        return new URL(address).hostname
      }
    } catch {
      // fall through
    }
    // "ip:port" format
    const colonIdx = address.lastIndexOf(':')
    if (colonIdx > 0 && !address.includes('[')) {
      return address.slice(0, colonIdx)
    }
    return address
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/bootstrap-service.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/bootstrap-service.ts src/node/bootstrap-service.test.ts
git commit -m "feat: implement BootstrapService with LRU cache, fanout, and address reflection"
```

---

## Task 5: Wire `BootstrapService` into `QDHTNode`

**Files:**
- Modify: `src/node/qdht-node.ts`
- Modify: `src/node/qdht-node.test.ts`

When `bootstrapMode` is true: skip Propagator, ReplicaStore, ReputationMap, ContentProviderRegistry; wire `BootstrapService` to PeerManager events and incoming messages; respond to `DELTA_REQUEST` using the peer list.

- [ ] **Step 1: Write the failing test**

Open `src/node/qdht-node.test.ts` and add:

```typescript
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeypair } from '../core/identity/keys.js'
import { QDHTNode } from './qdht-node.js'
import { MemoryNodeStorage } from '../core/storage/memory-node-storage.js'
import { WebSocket } from 'ws'
import { signEvent } from '../core/identity/signing.js'
import { QDHT_KIND } from '../core/nostr/kinds.js'

describe('QDHTNode bootstrapMode', () => {
  let node: QDHTNode | undefined
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'qdht-bs-'))
  })

  afterEach(async () => {
    await node?.stop()
    node = undefined
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('starts in bootstrap mode without error', async () => {
    const kp = generateKeypair()
    node = new QDHTNode(
      {
        identity: { privkey: kp.privkey },
        peers: [],
        port: 0,
        dataDir: tmpDir,
        bootstrapMode: true,
        maxPeers: 100,
      },
      new MemoryNodeStorage(),
    )
    await node.start()
    expect(node.listenPort()).toBeGreaterThan(0)
  })

  it('caches and fans out 30181 events received from peers', async () => {
    const nodeKp = generateKeypair()
    node = new QDHTNode(
      {
        identity: { privkey: nodeKp.privkey },
        peers: [],
        port: 0,
        dataDir: tmpDir,
        bootstrapMode: true,
      },
      new MemoryNodeStorage(),
    )
    await node.start()
    const port = node.listenPort()

    // Connect peer1 and send a 30181
    const peer1Kp = generateKeypair()
    const peer2Kp = generateKeypair()

    const peer1 = new WebSocket(`ws://127.0.0.1:${port}`)
    const peer2 = new WebSocket(`ws://127.0.0.1:${port}`)

    const peer2Received: unknown[] = []
    peer2.on('message', (data: import('ws').RawData) => {
      peer2Received.push(JSON.parse(data.toString()))
    })

    // Helper: wait until connection is open and send handshake
    async function doHandshake(ws: WebSocket, pubkey: string): Promise<void> {
      await new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'handshake', pubkey }))
          resolve()
          return
        }
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'handshake', pubkey }))
          resolve()
        })
      })
    }

    function wait(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    async function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
      const start = Date.now()
      while (!fn()) {
        if (Date.now() - start > timeoutMs) throw new Error('timeout')
        await wait(20)
      }
    }

    await doHandshake(peer1, peer1Kp.pubkey)
    await doHandshake(peer2, peer2Kp.pubkey)

    // Give peer2 time to connect and receive initial cache (empty at this point)
    await wait(100)
    const initialCount = peer2Received.length

    // peer1 sends a 30181
    const record = signEvent(
      {
        kind: QDHT_KIND.SERVICE_RECORD,
        pubkey: peer1Kp.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['transport', 'ws'], ['d', 'main'], ['url', 'ws://peer1:7777']],
        content: '',
        sig: '',
      },
      peer1Kp.privkey,
    )
    peer1.send(JSON.stringify(record))

    // peer2 should receive the broadcast
    await waitFor(
      () =>
        (peer2Received as Array<Record<string, unknown>>).some(
          (m) => m.kind === QDHT_KIND.SERVICE_RECORD && m.pubkey === peer1Kp.pubkey,
        ),
    )

    peer1.close()
    peer2.close()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/qdht-node.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: test imports succeed but `bootstrapMode` behaviour is not yet implemented, so the fanout test times out or the 30181 is not forwarded.

- [ ] **Step 3: Modify `QDHTNode`**

At the top of `src/node/qdht-node.ts`, add the import:

```typescript
import { BootstrapService } from './bootstrap-service.js'
```

In the class body, add a private field after the existing fields:

```typescript
  private bootstrapService: BootstrapService | null = null
```

In the constructor, wrap the four heavy subsystems. Replace these unconditional instantiations:

```typescript
    this.propagator = new Propagator(this.graph, this.graph.getIndex(this.kp.pubkey), 0.5)
    this.neighbourState = new NeighbourStateMap()
    this.replicaStore = new ReplicaStore()
    this.reputationMap = new ReputationMap()
    this.providerRegistry = new ContentProviderRegistry()
```

with:

```typescript
    this.propagator = config.bootstrapMode
      ? null as unknown as Propagator
      : new Propagator(this.graph, this.graph.getIndex(this.kp.pubkey), 0.5)
    this.neighbourState = config.bootstrapMode
      ? null as unknown as NeighbourStateMap
      : new NeighbourStateMap()
    this.replicaStore = config.bootstrapMode
      ? null as unknown as ReplicaStore
      : new ReplicaStore()
    this.reputationMap = config.bootstrapMode
      ? null as unknown as ReputationMap
      : new ReputationMap()
    this.providerRegistry = config.bootstrapMode
      ? null as unknown as ContentProviderRegistry
      : new ContentProviderRegistry()
```

Still in the constructor, after `this.peerManager = new PeerManager(...)`, add:

```typescript
    if (config.bootstrapMode) {
      this.bootstrapService = new BootstrapService({
        pubkey: this.kp.pubkey,
        privkey: this.kp.privkey,
        maxPeers: config.maxPeers,
      })

      // Wire BootstrapService into PeerManager
      this.peerManager.onPeerConnected((peerId: string, info: import('./peer-manager.js').PeerInfo) => {
        this.bootstrapService!.onPeerConnected(
          peerId,
          info.url,
          (msg) => this.peerManager.send(peerId, msg),
        )
      })
      this.peerManager.onPeerDisconnected((peerId: string) => {
        this.bootstrapService!.onPeerDisconnected(peerId)
      })
      this.peerManager.onMessage((msg: unknown, peerId: string) => {
        this.bootstrapService!.handleEvent(
          msg,
          peerId,
          (event) => this.peerManager.broadcast(event, peerId),
        )
      })
    }
```

Also update `stop()` to call `this.bootstrapService?.stop()` before `this.storage.close()`:

```typescript
  async stop(): Promise<void> {
    await this.webServer?.close()
    await this.disconnect()
    this.bootstrapService?.stop()
    this.storage.close()
    // ... rest unchanged
  }
```

Guard the `SyncManager` construction and `this.fetcher` similarly so they don't throw when their dependencies are null:

```typescript
    if (!config.bootstrapMode) {
      this.syncManager = new SyncManager({
        pubkey: this.kp.pubkey,
        privkey: this.kp.privkey,
        propagator: this.propagator,
        neighbourState: this.neighbourState,
        reputationMap: this.reputationMap,
        eventStore: this.storage.events,
        transports,
      })

      this.fetcher = new PieceFetcherService(
        this.providerRegistry,
        this.replicaStore,
        this.neighbourState,
        this.reputationMap,
      )
    } else {
      this.syncManager = null as unknown as SyncManager
      this.fetcher = null as unknown as PieceFetcherService
    }
```

Guard nip96 provider registration:

```typescript
    if (!config.bootstrapMode && config.nip96Servers) {
```

- [ ] **Step 4: Run tests**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/qdht-node.test.ts
```

Expected: bootstrap mode tests pass. Run the full suite to check no regressions:

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/node/qdht-node.ts src/node/qdht-node.test.ts
git commit -m "feat: wire BootstrapService into QDHTNode; guard heavy subsystems in bootstrapMode"
```

---

## Task 6: Add `--bootstrap` and `--max-peers` CLI flags

**Files:**
- Modify: `bin/qdht-node.ts`

- [ ] **Step 1: Locate the `start` command action**

Open `bin/qdht-node.ts`. The `start` command currently has:

```typescript
program
  .command('start')
  .description('Start the qDHT node daemon')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--port <port>', 'Override listen port', (value) => Number(value))
  .option('--web-port <port>', 'Override web UI port', (value) => Number(value))
  .option('--data-dir <dir>', 'Override data directory')
  .action(async (opts: { config: string; port?: number; webPort?: number; dataDir?: string }) => {
    const config = await loadNodeConfig(opts.config, {
      port: opts.port,
      webPort: opts.webPort,
      dataDir: opts.dataDir,
    })
```

- [ ] **Step 2: Add the new options**

Replace that block with:

```typescript
program
  .command('start')
  .description('Start the qDHT node daemon')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--port <port>', 'Override listen port', (value) => Number(value))
  .option('--web-port <port>', 'Override web UI port', (value) => Number(value))
  .option('--data-dir <dir>', 'Override data directory')
  .option('--bootstrap', 'Run in bootstrap mode (rendezvous only, no routing)')
  .option('--max-peers <n>', 'Maximum concurrent peers (bootstrap mode only)', (value) => Number(value))
  .option('--listen-address <url>', 'Publicly reachable WebSocket URL to advertise in 30181')
  .action(async (opts: {
    config: string
    port?: number
    webPort?: number
    dataDir?: string
    bootstrap?: boolean
    maxPeers?: number
    listenAddress?: string
  }) => {
    const config = await loadNodeConfig(opts.config, {
      port: opts.port,
      webPort: opts.webPort,
      dataDir: opts.dataDir,
      bootstrapMode: opts.bootstrap,
      maxPeers: opts.maxPeers,
      listenAddress: opts.listenAddress,
    })
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/mattthomson/workspace/qDHT && npm run build
```

Expected: no errors.

- [ ] **Step 4: Smoke-test the flag**

```bash
cd /home/mattthomson/workspace/qDHT && tsx bin/qdht-node.ts start --help | grep bootstrap
```

Expected: `--bootstrap` appears in the help output.

- [ ] **Step 5: Commit**

```bash
git add bin/qdht-node.ts
git commit -m "feat: add --bootstrap, --max-peers, --listen-address flags to CLI start command"
```

---

## Task 7: Integration smoke test — full bootstrap handshake

**Files:**
- Modify: `src/node/integration.test.ts` (or add a new `src/node/bootstrap-integration.test.ts`)

This test starts a real bootstrap node, connects two client nodes to it, has one publish a `30181`, and confirms the other receives it.

- [ ] **Step 1: Write the test**

Add to `src/node/bootstrap-integration.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WebSocket } from 'ws'
import { generateKeypair } from '../core/identity/keys.js'
import { signEvent } from '../core/identity/signing.js'
import { QDHTNode } from './qdht-node.js'
import { MemoryNodeStorage } from '../core/storage/memory-node-storage.js'
import { QDHT_KIND } from '../core/nostr/kinds.js'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(fn: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await wait(30)
  }
}

describe('Bootstrap node integration', () => {
  let bootstrap: QDHTNode
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'qdht-bsi-'))
    const kp = generateKeypair()
    bootstrap = new QDHTNode(
      {
        identity: { privkey: kp.privkey },
        peers: [],
        port: 0,
        dataDir: tmpDir,
        bootstrapMode: true,
      },
      new MemoryNodeStorage(),
    )
    await bootstrap.start()
  })

  afterEach(async () => {
    await bootstrap.stop()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('fans out a 30181 from peer1 to peer2', async () => {
    const port = bootstrap.listenPort()
    const peer1Kp = generateKeypair()
    const peer2Kp = generateKeypair()

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`)
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`)

    const peer2Messages: Array<Record<string, unknown>> = []
    ws2.on('message', (data: import('ws').RawData) => {
      try { peer2Messages.push(JSON.parse(data.toString())) } catch { /* ignore */ }
    })

    async function handshake(ws: WebSocket, pubkey: string): Promise<void> {
      await new Promise<void>((resolve) => {
        const doSend = (): void => {
          ws.send(JSON.stringify({ type: 'handshake', pubkey }))
          resolve()
        }
        ws.readyState === WebSocket.OPEN ? doSend() : ws.on('open', doSend)
      })
    }

    await handshake(ws1, peer1Kp.pubkey)
    await handshake(ws2, peer2Kp.pubkey)
    await wait(150)

    const record = signEvent(
      {
        kind: QDHT_KIND.SERVICE_RECORD,
        pubkey: peer1Kp.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['transport', 'ws'], ['d', 'main'], ['url', 'ws://peer1:7777']],
        content: '',
        sig: '',
      },
      peer1Kp.privkey,
    )
    ws1.send(JSON.stringify(record))

    await waitFor(() =>
      peer2Messages.some(
        (m) => m.kind === QDHT_KIND.SERVICE_RECORD && m.pubkey === peer1Kp.pubkey,
      ),
    )

    // Confirm peer2 also received a 30800 address reflection
    const reflection = peer2Messages.find((m) => m.kind === 30800)
    expect(reflection).toBeDefined()

    ws1.close()
    ws2.close()
  })

  it('sends existing cache to a late-joining peer', async () => {
    const port = bootstrap.listenPort()
    const peer1Kp = generateKeypair()
    const peer2Kp = generateKeypair()

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`)
    await new Promise<void>((resolve) => (ws1.readyState === WebSocket.OPEN ? resolve() : ws1.on('open', resolve)))
    ws1.send(JSON.stringify({ type: 'handshake', pubkey: peer1Kp.pubkey }))

    const record = signEvent(
      {
        kind: QDHT_KIND.SERVICE_RECORD,
        pubkey: peer1Kp.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['transport', 'ws'], ['d', 'main'], ['url', 'ws://peer1:7777']],
        content: '',
        sig: '',
      },
      peer1Kp.privkey,
    )
    ws1.send(JSON.stringify(record))
    await wait(100) // let bootstrap cache it

    // Now peer2 joins
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`)
    const peer2Messages: Array<Record<string, unknown>> = []
    ws2.on('message', (data: import('ws').RawData) => {
      try { peer2Messages.push(JSON.parse(data.toString())) } catch { /* ignore */ }
    })
    await new Promise<void>((resolve) => (ws2.readyState === WebSocket.OPEN ? resolve() : ws2.on('open', resolve)))
    ws2.send(JSON.stringify({ type: 'handshake', pubkey: peer2Kp.pubkey }))

    await waitFor(() =>
      peer2Messages.some(
        (m) => m.kind === QDHT_KIND.SERVICE_RECORD && m.pubkey === peer1Kp.pubkey,
      ),
    )

    ws1.close()
    ws2.close()
  })
})
```

- [ ] **Step 2: Run to confirm pass**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/bootstrap-integration.test.ts
```

Expected: both tests pass.

- [ ] **Step 3: Run full suite**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run
```

Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/node/bootstrap-integration.test.ts
git commit -m "test: integration test for bootstrap node fanout and cache replay"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by task |
|---|---|
| Section 1 — `bootstrapMode?`, `maxPeers?` on `QDHTConfig`, `validateConfig` | Task 2 |
| Section 1 — `--bootstrap` CLI flag | Task 6 |
| Section 2 — Skip Propagator, ReplicaStore, ReputationMap, ContentProviderRegistry | Task 5 |
| Section 2 — Keep PeerManager | Task 5 |
| Section 2 — Delta catch-up (`DELTA_REQUEST`/`DELTA_RESPONSE`) | Noted below |
| Section 3 — LRU cache keyed by pubkey | Task 4 |
| Section 3 — On connect: send cache + reflect address | Tasks 4 & 7 |
| Section 3 — On 30181 receipt: validate, deduplicate, upsert, rebroadcast | Task 4 |
| Section 3 — On disconnect: remove from cache | Task 4 |
| Section 3 — Eviction timer every 60s | Task 4 |
| Section 3 — `maxPeers` enforcement at upgrade | Not yet — see note |
| Section 4 — `NODE_PROFILE`/`SERVICE_RECORD` kind constants | Task 1 |
| Section 4 — `PeerManager` publishes 30181 on handshake | Task 3 |
| Section 5 — All error handling cases | Covered by unit tests in Task 4 |

**Delta catch-up note:** The spec states the bootstrap node should respond to `DELTA_REQUEST` (kind `20800`) using its peer list. This involves `SyncManager` which is skipped in bootstrap mode. The minimal correct approach is to handle the delta request directly in the bootstrap event handler: when a `DELTA_REQUEST` message is received, respond with a `DELTA_RESPONSE` containing the IDs of all cached `30181` events. This is lightweight and does not require `SyncManager`. Add this to `BootstrapService.handleEvent`:

```typescript
  // In handleEvent, before the SERVICE_RECORD check:
  if (e.kind === QDHT_KIND.DELTA_REQUEST) {
    this.handleDeltaRequest(fromPeerId, reply)
    return
  }
```

And add a `handleDeltaRequest` private method to `BootstrapService`:

```typescript
  private handleDeltaRequest(fromPeerId: string, reply: SendFn): void {
    const now = Math.floor(Date.now() / 1000)
    const eventIds = [...this.cache.values()].map((e) => e.id)
    const response = signEvent(
      {
        kind: QDHT_KIND.DELTA_RESPONSE,
        pubkey: this.pubkey,
        created_at: now,
        tags: [['p', fromPeerId]],
        content: JSON.stringify({ eventIds }),
        sig: '',
      },
      this.privkey,
    )
    reply(response)
  }
```

Update `handleEvent`'s signature to accept a separate `reply` (send back to the originating peer) vs. `broadcast` (send to all other peers). The simplest fix: pass `reply` as the second callback:

```typescript
  handleEvent(event: unknown, fromPeerId: string, broadcast: SendFn, reply?: SendFn): void {
```

This delta-catch-up addition should be appended to Task 4 as an extra step before the commit, and a corresponding unit test added to `bootstrap-service.test.ts`.

**`maxPeers` at WebSocket upgrade:** The spec says to enforce `maxPeers` at the `upgrade` event before the handshake completes, sending close code `1008`. The current `PeerManager` handles connections in the `server.on('connection')` callback and does not expose the `upgrade` event. The cleanest approach matching the existing architecture is to enforce `maxPeers` in `BootstrapService.onPeerConnected` — if `cache.size >= maxPeers`, send a close message to the new peer and immediately close it. This is a slight deviation from the spec (post-upgrade rather than pre-upgrade) but is simpler and achieves the same outcome without modifying `PeerManager` internals. Add a note to this effect in the bootstrap service implementation.
