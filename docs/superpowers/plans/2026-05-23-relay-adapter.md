# Relay Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Nostr-relay transport layer so qDHT nodes can discover and sync with peers they cannot reach via direct WebSocket, by extracting a `Transport` interface, implementing `RelayAdapter` with `nostr-tools` `SimplePool`, and wiring both transports into `SyncManager`.

**Architecture:** A `Transport` interface is extracted into `src/node/transport.ts`; `PeerManager` adds `implements Transport` without logic changes; `RelayAdapter` implements `Transport` using `nostr-tools` `SimplePool`; `SyncManager` accepts `transports: Transport[]` and fans all messages to every transport.

**Tech Stack:** TypeScript, Vitest, `nostr-tools` v2 (`SimplePool`), `ws` (existing), Node.js

---

## File Map

| Action | File | Purpose |
|---|---|---|
| **Create** | `src/node/transport.ts` | `Transport` interface contract |
| **Modify** | `src/node/peer-manager.ts` | Add `implements Transport` |
| **Create** | `src/node/relay-adapter.ts` | `RelayAdapter` — nostr-tools SimplePool transport |
| **Create** | `src/node/relay-adapter.test.ts` | Unit tests for `RelayAdapter` (mocked SimplePool) |
| **Modify** | `src/node/sync-manager.ts` | Accept `transports: Transport[]`, fan-out broadcast/send |
| **Modify** | `src/node/sync-manager.test.ts` | Update to pass `transports: [mockTransport]` |
| **Modify** | `src/node/config.ts` | Add optional `relays?: string[]` to `QDHTConfig` |
| **Modify** | `src/node/config.test.ts` | Cover new `relays` field validation |
| **Modify** | `src/node/qdht-node.ts` | Wire `RelayAdapter` when `config.relays` is set |
| **Modify** | `src/node/integration.test.ts` | Add relay fan-out integration test (stub transport) |

---

### Task 1: Define the Transport interface

**Files:**
- Create: `src/node/transport.ts`

- [ ] **Step 1: Write the file**

```ts
// src/node/transport.ts

/** Minimum contract every transport must satisfy. */
export interface Transport {
  /** Register a handler for all inbound messages from this transport. */
  onMessage(handler: (msg: unknown, peerId: string) => void): void

  /** Register a handler called when a peer becomes available on this transport. */
  onPeerConnected(handler: (peerId: string) => void): void

  /** Register a handler called when a peer disappears from this transport. */
  onPeerDisconnected(handler: (peerId: string) => void): void

  /** Send msg to all peers on this transport, optionally excluding one peer. */
  broadcast(msg: unknown, excludePeerId?: string): void

  /** Send msg to a specific peer on this transport. No-op if peerId is unknown. */
  send(peerId: string, msg: unknown): void

  /** Tear down all connections and timers. */
  close(): Promise<void>
}
```

- [ ] **Step 2: Confirm the file compiles (no tests yet)**

```bash
cd /home/mattthomson/workspace/qDHT && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/node/transport.ts
git commit -m "feat(transport): define Transport interface"
```

---

### Task 2: Make PeerManager implement Transport

**Files:**
- Modify: `src/node/peer-manager.ts`

**Background:** `PeerManager` already has `onMessage`, `onPeerConnected`, `onPeerDisconnected`, `broadcast`, `send`, and `close` — but the `onPeerConnected`/`onPeerDisconnected` handler signatures differ: they pass `(peerId: string, info: PeerInfo)` instead of the bare `(peerId: string)` required by `Transport`.

The fix is to add a second, Transport-compatible set of handlers inside `PeerManager` and expose them via the interface methods, keeping the existing `PeerHandler = (peerId: string, info: PeerInfo) => void` overloads intact for `QDHTNode`'s use.

- [ ] **Step 1: Import Transport and add `implements Transport` to the class declaration**

In `src/node/peer-manager.ts`, add at the top:

```ts
import type { Transport } from './transport.js'
```

Change the class line from:

```ts
export class PeerManager {
```

to:

```ts
export class PeerManager implements Transport {
```

- [ ] **Step 2: Add Transport-compatible handler lists**

Inside the class, add two new private fields after the existing `peerDisconnectedHandlers` line:

```ts
private transportConnectedHandlers: ((peerId: string) => void)[] = []
private transportDisconnectedHandlers: ((peerId: string) => void)[] = []
```

- [ ] **Step 3: Add Transport-compatible `onPeerConnected` and `onPeerDisconnected` overloads**

`PeerManager.onPeerConnected` currently accepts `PeerHandler`. The `Transport` interface requires `(handler: (peerId: string) => void) => void`. Resolve the conflict by making both methods accept a union:

Replace the existing `onPeerConnected` and `onPeerDisconnected` method bodies:

```ts
onPeerConnected(handler: ((peerId: string) => void) | PeerHandler): void {
  if (handler.length === 1) {
    this.transportConnectedHandlers.push(handler as (peerId: string) => void)
  } else {
    this.peerConnectedHandlers.push(handler as PeerHandler)
  }
}

onPeerDisconnected(handler: ((peerId: string) => void) | PeerHandler): void {
  if (handler.length === 1) {
    this.transportDisconnectedHandlers.push(handler as (peerId: string) => void)
  } else {
    this.peerDisconnectedHandlers.push(handler as PeerHandler)
  }
}
```

- [ ] **Step 4: Fire transport-compat handlers from `notifyConnected` and `notifyDisconnected`**

At the end of `notifyConnected(peerId, peer)`:

```ts
for (const handler of this.transportConnectedHandlers) {
  handler(peerId)
}
```

At the end of `notifyDisconnected(peer)`:

```ts
const id = peer.pubkey || peer.tempId
for (const handler of this.transportDisconnectedHandlers) {
  handler(id)
}
```

- [ ] **Step 5: Confirm compilation**

```bash
cd /home/mattthomson/workspace/qDHT && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Run existing peer-manager tests**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/peer-manager.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/node/peer-manager.ts
git commit -m "feat(transport): PeerManager implements Transport"
```

---

### Task 3: Refactor SyncManager to accept `Transport[]`

**Files:**
- Modify: `src/node/sync-manager.ts`
- Modify: `src/node/sync-manager.test.ts`

- [ ] **Step 1: Write the failing test first — add a two-transport fan-out test**

Open `src/node/sync-manager.test.ts`. Find the existing import block and add at the top:

```ts
import type { Transport } from './transport.js'
```

Add a helper factory for a mock transport (add near the top of the file, before any `describe` blocks):

```ts
function makeMockTransport(): Transport & {
  broadcasts: Array<{ msg: unknown; excludePeerId?: string }>
  sends: Array<{ peerId: string; msg: unknown }>
  messageHandler: ((msg: unknown, peerId: string) => void) | null
  connectedHandler: ((peerId: string) => void) | null
  disconnectedHandler: ((peerId: string) => void) | null
} {
  let messageHandler: ((msg: unknown, peerId: string) => void) | null = null
  let connectedHandler: ((peerId: string) => void) | null = null
  let disconnectedHandler: ((peerId: string) => void) | null = null
  const broadcasts: Array<{ msg: unknown; excludePeerId?: string }> = []
  const sends: Array<{ peerId: string; msg: unknown }> = []

  const transport = {
    broadcasts,
    sends,
    get messageHandler() { return messageHandler },
    get connectedHandler() { return connectedHandler },
    get disconnectedHandler() { return disconnectedHandler },
    onMessage(h: (msg: unknown, peerId: string) => void) { messageHandler = h },
    onPeerConnected(h: (peerId: string) => void) { connectedHandler = h },
    onPeerDisconnected(h: (peerId: string) => void) { disconnectedHandler = h },
    broadcast(msg: unknown, excludePeerId?: string) { broadcasts.push({ msg, excludePeerId }) },
    send(peerId: string, msg: unknown) { sends.push({ peerId, msg }) },
    async close() {},
  }
  return transport
}
```

Add a new describe block:

```ts
describe('SyncManager with two transports', () => {
  it('fans broadcast to both transports', () => {
    const t1 = makeMockTransport()
    const t2 = makeMockTransport()
    const sync = new SyncManager({
      pubkey: 'a'.repeat(64),
      privkey: 'a'.repeat(64),
      propagator: new Propagator(new GraphState(), 0, 0.5),
      neighbourState: new NeighbourStateMap(),
      transports: [t1, t2],
    })

    sync.publishAnnouncement({
      qkey: 'testkey',
      hash: 'abc123',
      sizeBytes: 10,
      pieces: 1,
      pieceSize: 10,
      ttl: 3600,
    })

    expect(t1.broadcasts.length).toBeGreaterThan(0)
    expect(t2.broadcasts.length).toBeGreaterThan(0)
  })

  it('fans send to both transports', () => {
    const t1 = makeMockTransport()
    const t2 = makeMockTransport()
    const sync = new SyncManager({
      pubkey: 'a'.repeat(64),
      privkey: 'a'.repeat(64),
      propagator: new Propagator(new GraphState(), 0, 0.5),
      neighbourState: new NeighbourStateMap(),
      transports: [t1, t2],
    })

    sync.sendDeltaRequest('somePeer', 0)
    expect(t1.sends.some((s) => s.peerId === 'somePeer')).toBe(true)
    expect(t2.sends.some((s) => s.peerId === 'somePeer')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/sync-manager.test.ts
```

Expected: compilation error — `transports` is not a known option yet.

- [ ] **Step 3: Update `SyncManagerOptions` in `sync-manager.ts`**

Replace:

```ts
import { isSignedEvent, type SignedNostrEvent } from '../core/nostr/event.js'
```

with:

```ts
import { isSignedEvent, type SignedNostrEvent } from '../core/nostr/event.js'
import type { Transport } from './transport.js'
```

Replace the `SyncManagerOptions` interface:

```ts
export interface SyncManagerOptions {
  pubkey: string
  privkey: string
  propagator: Propagator
  neighbourState: NeighbourStateMap
  broadcast: (msg: unknown, excludePeerId?: string) => void
  send: (peerId: string, msg: unknown) => void
}
```

with:

```ts
export interface SyncManagerOptions {
  pubkey: string
  privkey: string
  propagator: Propagator
  neighbourState: NeighbourStateMap
  transports: Transport[]
}
```

- [ ] **Step 4: Wire transports in the constructor**

Replace the entire `constructor` body:

```ts
constructor(private opts: SyncManagerOptions) {}
```

with:

```ts
constructor(private opts: SyncManagerOptions) {
  for (const t of opts.transports) {
    t.onMessage((msg, peerId) => this.handleMessage(msg, peerId))
    t.onPeerConnected((peerId) => this.onPeerConnected(peerId))
    t.onPeerDisconnected((peerId) => this.peerLastSeen.delete(peerId))
  }
}
```

- [ ] **Step 5: Add private `broadcast` and `send` helpers**

Add after the `constructor`:

```ts
private broadcast(msg: unknown, excludePeerId?: string): void {
  for (const t of this.opts.transports) {
    t.broadcast(msg, excludePeerId)
  }
}

private send(peerId: string, msg: unknown): void {
  for (const t of this.opts.transports) {
    t.send(peerId, msg)
  }
}
```

- [ ] **Step 6: Fix call sites — `this.opts.broadcast` → `this.broadcast`, `this.opts.send` → `this.send`**

In `publishAnnouncement`, change:

```ts
this.opts.broadcast(signed)
```

to:

```ts
this.broadcast(signed)
```

In `sendDeltaRequest`, change:

```ts
this.opts.send(peerId, req)
```

to:

```ts
this.send(peerId, req)
```

In `handleAnnouncement`, change:

```ts
this.opts.broadcast(event, fromPeerId)
```

to:

```ts
this.broadcast(event, fromPeerId)
```

In `handleDeltaRequest`, change:

```ts
this.opts.send(fromPeerId, response)
```

to:

```ts
this.send(fromPeerId, response)
```

- [ ] **Step 7: Update all existing sync-manager tests to use `transports: [mockTransport]`**

In `src/node/sync-manager.test.ts`, find every place a `SyncManager` is constructed with `broadcast:` and `send:` function props. Replace each with `transports: [t1]` where `t1` is a `makeMockTransport()`. Remove `broadcast` and `send` from those options objects.

For example, change:

```ts
const sync = new SyncManager({
  pubkey: '...',
  privkey: '...',
  propagator: ...,
  neighbourState: ...,
  broadcast: vi.fn(),
  send: vi.fn(),
})
```

to:

```ts
const t1 = makeMockTransport()
const sync = new SyncManager({
  pubkey: '...',
  privkey: '...',
  propagator: ...,
  neighbourState: ...,
  transports: [t1],
})
```

Adjust any assertions that previously checked `mockBroadcast` / `mockSend` to check `t1.broadcasts` / `t1.sends` instead.

- [ ] **Step 8: Run all sync-manager tests**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/sync-manager.test.ts
```

Expected: all pass.

- [ ] **Step 9: Confirm full compile**

```bash
cd /home/mattthomson/workspace/qDHT && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 10: Commit**

```bash
git add src/node/sync-manager.ts src/node/sync-manager.test.ts
git commit -m "refactor(sync): SyncManager accepts Transport[] instead of bare function props"
```

---

### Task 4: Update QDHTNode to pass PeerManager as Transport[]

**Files:**
- Modify: `src/node/qdht-node.ts`

`QDHTNode` currently wires `PeerManager` into `SyncManager` via bare function props. After Task 3, `SyncManager` expects `transports`. Also, `QDHTNode` currently manually calls `peerManager.onMessage` and `peerManager.onPeerConnected` — after this task `SyncManager` does that wiring itself via `transports`.

- [ ] **Step 1: Write the failing integration test**

Run the existing integration test to confirm it fails after the sync-manager change:

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/integration.test.ts
```

Expected: fail (TypeScript error — `QDHTNode` still passes old `broadcast`/`send` props).

- [ ] **Step 2: Update `QDHTNode` constructor**

In `src/node/qdht-node.ts`, add at the top:

```ts
import type { Transport } from './transport.js'
```

Replace the entire `SyncManager` construction block and the two `peerManager.on*` calls:

```ts
this.syncManager = new SyncManager({
  pubkey: this.kp.pubkey,
  privkey: this.kp.privkey,
  propagator: this.propagator,
  neighbourState: this.neighbourState,
  broadcast: (msg, excludePeerId) => this.peerManager.broadcast(msg, excludePeerId),
  send: (peerId, msg) => this.peerManager.send(peerId, msg),
})

this.peerManager.onMessage((msg, peerId) => {
  this.syncManager.handleMessage(msg, peerId)
})
this.peerManager.onPeerConnected((peerId) => {
  this.syncManager.onPeerConnected(peerId)
})
```

with:

```ts
const transports: Transport[] = [this.peerManager]
this.syncManager = new SyncManager({
  pubkey: this.kp.pubkey,
  privkey: this.kp.privkey,
  propagator: this.propagator,
  neighbourState: this.neighbourState,
  transports,
})
```

Also add a private field for later use:

```ts
private relayAdapter: import('./relay-adapter.js').RelayAdapter | null = null
```

Add this field declaration in the class body alongside the other private fields.

- [ ] **Step 3: Run integration tests**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/integration.test.ts
```

Expected: existing test passes.

- [ ] **Step 4: Run all tests**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/qdht-node.ts
git commit -m "refactor(node): wire PeerManager into SyncManager via Transport[]"
```

---

### Task 5: Add `relays` to the config schema

**Files:**
- Modify: `src/node/config.ts`
- Modify: `src/node/config.test.ts`

- [ ] **Step 1: Write failing tests for the `relays` field**

Open `src/node/config.test.ts`. Add a `describe` block:

```ts
describe('relays field', () => {
  it('accepts a valid config with relays array', () => {
    const raw = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: '/tmp/test',
      relays: ['wss://relay.damus.io', 'wss://nos.lol'],
    }
    const cfg = validateConfig(raw, 'test')
    expect(cfg.relays).toEqual(['wss://relay.damus.io', 'wss://nos.lol'])
  })

  it('accepts config with no relays field', () => {
    const raw = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: '/tmp/test',
    }
    const cfg = validateConfig(raw, 'test')
    expect(cfg.relays).toBeUndefined()
  })

  it('rejects relays field that is not an array of strings', () => {
    const raw = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: '/tmp/test',
      relays: [42],
    }
    expect(() => validateConfig(raw, 'test')).toThrow('relays must be an array of strings')
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/config.test.ts
```

Expected: 2 pass (relays undefined), 1 fail (relays array not accepted / not validated).

- [ ] **Step 3: Update `QDHTConfig` interface**

In `src/node/config.ts`, add the optional field to `QDHTConfig`:

```ts
export interface QDHTConfig {
  identity: { privkey: string }
  peers: string[]
  port: number
  dataDir: string
  relays?: string[]
}
```

- [ ] **Step 4: Validate `relays` in `validateConfig`**

Add after the `dataDir` validation block, before the `return`:

```ts
  const relays = candidate.relays
  if (relays !== undefined) {
    if (!Array.isArray(relays) || !relays.every((r) => typeof r === 'string')) {
      throw new Error('relays must be an array of strings')
    }
  }
```

Update the `return` statement to include `relays`:

```ts
  return {
    identity: { privkey: validatePrivkey((identity as Record<string, unknown>).privkey) },
    peers,
    port,
    dataDir,
    relays: relays as string[] | undefined,
  }
```

- [ ] **Step 5: Run config tests**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/config.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/node/config.ts src/node/config.test.ts
git commit -m "feat(config): add optional relays[] to QDHTConfig"
```

---

### Task 6: Implement RelayAdapter

**Files:**
- Create: `src/node/relay-adapter.ts`
- Create: `src/node/relay-adapter.test.ts`

Note: the existing `src/core/nostr/relay-adapter.ts` is the Phase 3 `LiveNodeAdapter` seam — leave it untouched. The new file lives in `src/node/`.

- [ ] **Step 1: Write the failing tests first**

Create `src/node/relay-adapter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { RelayAdapter } from './relay-adapter.js'

// Manual mock for nostr-tools SimplePool
const mockSub = { close: vi.fn() }
const mockPool = {
  subscribeMany: vi.fn().mockReturnValue(mockSub),
  publish: vi.fn(),
  close: vi.fn(),
}

vi.mock('nostr-tools', () => ({
  SimplePool: vi.fn(() => mockPool),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockPool.subscribeMany.mockReturnValue(mockSub)
})

describe('RelayAdapter', () => {
  const relayUrls = ['wss://relay.damus.io', 'wss://nos.lol']
  const privkey = 'a'.repeat(64)

  it('connect() subscribes with default qDHT kinds filter', async () => {
    const adapter = new RelayAdapter({ privkey, relayUrls })
    await adapter.connect()

    expect(mockPool.subscribeMany).toHaveBeenCalledOnce()
    const [urls, filters] = (mockPool.subscribeMany as Mock).mock.calls[0] as [string[], unknown[], unknown]
    expect(urls).toEqual(relayUrls)
    expect((filters[0] as { kinds: number[] }).kinds).toEqual([10800, 10801, 10802, 10803, 20800, 20801])
  })

  it('connect() uses a custom filter when provided', async () => {
    const customFilter = { kinds: [10800] }
    const adapter = new RelayAdapter({ privkey, relayUrls, filter: customFilter })
    await adapter.connect()

    const [, filters] = (mockPool.subscribeMany as Mock).mock.calls[0] as [string[], unknown[], unknown]
    expect((filters[0] as { kinds: number[] }).kinds).toEqual([10800])
  })

  it('broadcast() publishes a valid signed event to all relay URLs', async () => {
    const adapter = new RelayAdapter({ privkey, relayUrls })
    await adapter.connect()

    const validEvent = { id: 'abc', sig: 'def', pubkey: 'pub', kind: 10800, content: '', tags: [], created_at: 0 }
    adapter.broadcast(validEvent)

    expect(mockPool.publish).toHaveBeenCalledWith(relayUrls, validEvent)
  })

  it('broadcast() is a no-op for events missing id/sig/pubkey', async () => {
    const adapter = new RelayAdapter({ privkey, relayUrls })
    await adapter.connect()

    adapter.broadcast({ kind: 10800 })
    expect(mockPool.publish).not.toHaveBeenCalled()
  })

  it('send() publishes just like broadcast() (relay has no direct addressing)', async () => {
    const adapter = new RelayAdapter({ privkey, relayUrls })
    await adapter.connect()

    const validEvent = { id: 'abc', sig: 'def', pubkey: 'pub', kind: 10800, content: '', tags: [], created_at: 0 }
    adapter.send('somePeerId', validEvent)

    expect(mockPool.publish).toHaveBeenCalledWith(relayUrls, validEvent)
  })

  it('close() tears down the subscription and pool', async () => {
    const adapter = new RelayAdapter({ privkey, relayUrls })
    await adapter.connect()
    await adapter.close()

    expect(mockSub.close).toHaveBeenCalledOnce()
    expect(mockPool.close).toHaveBeenCalledWith(relayUrls)
  })

  it('close() before connect() does not throw', async () => {
    const adapter = new RelayAdapter({ privkey, relayUrls })
    await expect(adapter.close()).resolves.toBeUndefined()
    expect(mockSub.close).not.toHaveBeenCalled()
  })

  it('onMessage handlers receive events forwarded from the relay', async () => {
    const adapter = new RelayAdapter({ privkey, relayUrls })
    const received: Array<{ msg: unknown; peerId: string }> = []
    adapter.onMessage((msg, peerId) => received.push({ msg, peerId }))
    await adapter.connect()

    // Simulate the relay calling onevent
    const [, , { onevent }] = (mockPool.subscribeMany as Mock).mock.calls[0] as [
      string[],
      unknown[],
      { onevent: (e: unknown) => void },
    ]
    const fakeEvent = { id: 'x', sig: 'y', pubkey: 'zpubkey', kind: 10800, content: '', tags: [], created_at: 1 }
    onevent(fakeEvent)

    expect(received).toHaveLength(1)
    expect(received[0].peerId).toBe('zpubkey')
    expect(received[0].msg).toEqual(fakeEvent)
  })

  it('onevent drops events whose kind is not in the allowed list', async () => {
    const adapter = new RelayAdapter({ privkey, relayUrls })
    const received: unknown[] = []
    adapter.onMessage((msg) => received.push(msg))
    await adapter.connect()

    const [, , { onevent }] = (mockPool.subscribeMany as Mock).mock.calls[0] as [
      string[],
      unknown[],
      { onevent: (e: unknown) => void },
    ]
    onevent({ id: 'x', sig: 'y', pubkey: 'z', kind: 1, content: '', tags: [], created_at: 1 })

    expect(received).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/relay-adapter.test.ts
```

Expected: error — `relay-adapter.ts` not found.

- [ ] **Step 3: Implement `RelayAdapter`**

Create `src/node/relay-adapter.ts`:

```ts
import { SimplePool, type Filter as NostrFilter } from 'nostr-tools'
import type { Transport } from './transport.js'

const QDHT_KINDS = [10800, 10801, 10802, 10803, 20800, 20801]

const DEFAULT_FILTER: NostrFilter = {
  kinds: QDHT_KINDS,
}

export interface RelayAdapterOptions {
  privkey: string
  relayUrls: string[]
  filter?: NostrFilter
}

type MessageHandler = (msg: unknown, peerId: string) => void
type PeerHandler = (peerId: string) => void

function isSignedShape(msg: unknown): msg is { id: string; sig: string; pubkey: string } {
  if (!msg || typeof msg !== 'object') {
    return false
  }
  const obj = msg as Record<string, unknown>
  return typeof obj.id === 'string' && typeof obj.sig === 'string' && typeof obj.pubkey === 'string'
}

export class RelayAdapter implements Transport {
  private pool: SimplePool
  private sub: { close(): void } | null = null
  private filter: NostrFilter
  private messageHandlers: MessageHandler[] = []
  private connectedHandlers: PeerHandler[] = []
  private disconnectedHandlers: PeerHandler[] = []

  constructor(private opts: RelayAdapterOptions) {
    this.pool = new SimplePool()
    this.filter = opts.filter ?? DEFAULT_FILTER
  }

  async connect(): Promise<void> {
    this.sub = this.pool.subscribeMany(this.opts.relayUrls, [this.filter], {
      onevent: (event: unknown) => this.handleEvent(event),
    })
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler)
  }

  onPeerConnected(handler: PeerHandler): void {
    this.connectedHandlers.push(handler)
  }

  onPeerDisconnected(handler: PeerHandler): void {
    this.disconnectedHandlers.push(handler)
  }

  broadcast(msg: unknown, _excludePeerId?: string): void {
    if (!isSignedShape(msg)) {
      return
    }
    this.pool.publish(this.opts.relayUrls, msg as Parameters<SimplePool['publish']>[1])
  }

  send(peerId: string, msg: unknown): void {
    // Relay has no direct addressing — publish to all relays, ignore peerId.
    void peerId
    this.broadcast(msg)
  }

  async close(): Promise<void> {
    if (this.sub) {
      this.sub.close()
      this.sub = null
    }
    this.pool.close(this.opts.relayUrls)
  }

  private handleEvent(event: unknown): void {
    if (!event || typeof event !== 'object') {
      return
    }
    const e = event as Record<string, unknown>
    if (!QDHT_KINDS.includes(e.kind as number)) {
      return
    }
    const peerId = typeof e.pubkey === 'string' ? e.pubkey : 'unknown'
    for (const handler of this.messageHandlers) {
      handler(event, peerId)
    }
  }
}
```

- [ ] **Step 4: Run the relay-adapter tests**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/relay-adapter.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Check compile**

```bash
cd /home/mattthomson/workspace/qDHT && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/node/relay-adapter.ts src/node/relay-adapter.test.ts
git commit -m "feat(relay): implement RelayAdapter using nostr-tools SimplePool"
```

---

### Task 7: Wire RelayAdapter into QDHTNode

**Files:**
- Modify: `src/node/qdht-node.ts`

- [ ] **Step 1: Update imports**

In `src/node/qdht-node.ts`, add:

```ts
import { RelayAdapter } from './relay-adapter.js'
```

Remove the dynamic import type reference added in Task 4 (if used) — replace with the static import above.

- [ ] **Step 2: Replace the private field placeholder with the concrete type**

Change:

```ts
private relayAdapter: import('./relay-adapter.js').RelayAdapter | null = null
```

to:

```ts
private relayAdapter: RelayAdapter | null = null
```

- [ ] **Step 3: Construct RelayAdapter when `config.relays` is set — move transport wiring to `start()`**

`RelayAdapter.connect()` is async so it must be called in `start()`, not the constructor.

In the constructor, after `const transports: Transport[] = [this.peerManager]`, store the relay options for later but do not instantiate yet. Instead, update the constructor:

```ts
// In constructor — build transports array with only PeerManager for now
const transports: Transport[] = [this.peerManager]
this.syncManager = new SyncManager({
  pubkey: this.kp.pubkey,
  privkey: this.kp.privkey,
  propagator: this.propagator,
  neighbourState: this.neighbourState,
  transports,
})
```

Update `start()` to create and connect `RelayAdapter` before starting anything else, then add it to `SyncManager`. Because `SyncManager` is constructed in the constructor, append the relay adapter to transports after construction using a method, OR restructure to build transports in `start()`.

The cleanest approach: move SyncManager construction into `start()`.

Remove the `SyncManager` construction from the constructor. Add a `syncManager` nullable field:

```ts
private syncManager: SyncManager | null = null
```

Update `start()`:

```ts
async start(): Promise<void> {
  if (this.started) {
    return
  }
  this.started = true
  await mkdir(this.config.dataDir, { recursive: true })
  await this.peerManager.listen()

  const transports: Transport[] = [this.peerManager]
  if (this.config.relays && this.config.relays.length > 0) {
    const relay = new RelayAdapter({
      privkey: this.kp.privkey,
      relayUrls: this.config.relays,
    })
    await relay.connect()
    this.relayAdapter = relay
    transports.push(relay)
  }

  this.syncManager = new SyncManager({
    pubkey: this.kp.pubkey,
    privkey: this.kp.privkey,
    propagator: this.propagator,
    neighbourState: this.neighbourState,
    transports,
  })

  for (const peer of this.config.peers) {
    this.peerManager.connect(peer)
  }
  await this.startRpc()
}
```

Update `stop()` to call `this.relayAdapter?.close()`:

```ts
async stop(): Promise<void> {
  if (!this.started) {
    return
  }
  this.started = false
  await this.peerManager.close()
  await this.relayAdapter?.close()
  this.relayAdapter = null
  if (this.rpcServer) {
    await new Promise<void>((resolve) => this.rpcServer?.close(() => resolve()))
    this.rpcServer = null
  }
  try {
    await unlink(this.sockPath())
  } catch {
    // ignore
  }
}
```

Update all methods that call `this.syncManager.*` to handle the case where `syncManager` could be null before `start()`. The only public methods that delegate to syncManager are `put` and `hasReceivedKey`. Add a guard:

```ts
async put(data: Buffer, meta: PutMeta): Promise<ContentLocation> {
  if (!this.syncManager) {
    throw new Error('Node not started — call start() first')
  }
  const loc = await this.contentStore.put(data, meta)
  this.syncManager.publishAnnouncement({
    qkey: loc.qkey,
    hash: loc.hash,
    sizeBytes: loc.sizeBytes,
    pieces: loc.totalPieces,
    pieceSize: loc.pieceSize,
    ttl: meta.ttl,
    mime: meta.mime,
    name: meta.name,
  })
  return loc
}

hasReceivedKey(qkey: string): boolean {
  return this.neighbourState.get(qkey) !== undefined
}
```

- [ ] **Step 4: Run all tests**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run
```

Expected: all pass.

- [ ] **Step 5: Compile check**

```bash
cd /home/mattthomson/workspace/qDHT && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/node/qdht-node.ts
git commit -m "feat(node): wire RelayAdapter into QDHTNode when config.relays is set"
```

---

### Task 8: Integration test — publish via relay, receive on subscriber

**Files:**
- Modify: `src/node/integration.test.ts`

This test uses a stub in-process relay (not a real Nostr relay server). Two nodes each use a `RelayAdapter` pointed at the same stub URLs. A fake `SimplePool` is injected via a module mock that intercepts `subscribeMany` and `publish` and routes events between subscribers.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `src/node/integration.test.ts`:

```ts
import { vi, type Mock } from 'vitest'

// ---- Stub relay bus (in-process) ----
// A shared event bus that mimics a Nostr relay: publish routes to all subscribers.
const relayBus = (() => {
  const subscribers: Array<(event: unknown) => void> = []
  return {
    subscribe(cb: (event: unknown) => void) {
      subscribers.push(cb)
      return { close: () => { const i = subscribers.indexOf(cb); if (i !== -1) subscribers.splice(i, 1) } }
    },
    publish(event: unknown) {
      for (const cb of subscribers) {
        cb(event)
      }
    },
    reset() {
      subscribers.length = 0
    },
  }
})()

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>()
  return {
    ...actual,
    SimplePool: vi.fn(() => ({
      subscribeMany: (_urls: string[], _filters: unknown[], opts: { onevent(e: unknown): void }) => {
        return relayBus.subscribe((e) => opts.onevent(e))
      },
      publish: (_urls: string[], event: unknown) => {
        relayBus.publish(event)
      },
      close: vi.fn(),
    })),
  }
})
```

Then add the test:

```ts
describe('relay transport integration', () => {
  it('node B receives announcement published by node A via relay', async () => {
    relayBus.reset()

    const cfgA: QDHTConfig = {
      identity: { privkey: 'c'.repeat(64) },
      peers: [],
      port: 19960,
      dataDir: dirA,
      relays: ['wss://stub-relay'],
    }
    const cfgB: QDHTConfig = {
      identity: { privkey: 'd'.repeat(64) },
      peers: [],
      port: 19961,
      dataDir: dirB,
      relays: ['wss://stub-relay'],
    }

    nodeA = new QDHTNode(cfgA)
    await nodeA.start()

    nodeB = new QDHTNode(cfgB)
    await nodeB.start()

    const loc = await nodeA.put(Buffer.from('hello via relay'), { name: 'relay.txt', ttl: 3600 })
    await waitFor(() => nodeB!.hasReceivedKey(loc.qkey), 5000)

    expect(nodeB.hasReceivedKey(loc.qkey)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the integration test to see it fail**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run src/node/integration.test.ts
```

Expected: new test fails — `QDHTConfig` doesn't accept `relays` yet (fixed by Task 5), or relay events are not routed (the stub may not yet be wired correctly).

- [ ] **Step 3: Fix any wiring issues revealed by the test failure**

Common issues:
- The `vi.mock('nostr-tools', ...)` must be at the top of the file (before imports) — if Vitest hoisting is needed, move the mock to a `__mocks__/nostr-tools.ts` file or use `vi.hoisted`.
- The stub relay bus must route published events to subscribers synchronously or await a tick.

If the mock hoisting is required, restructure as:

```ts
const { relayBus, mockSimplePool } = vi.hoisted(() => {
  const subscribers: Array<(event: unknown) => void> = []
  const relayBus = {
    subscribe(cb: (event: unknown) => void) {
      subscribers.push(cb)
      return { close: () => { const i = subscribers.indexOf(cb); if (i !== -1) subscribers.splice(i, 1) } }
    },
    publish(event: unknown) { for (const cb of subscribers) cb(event) },
    reset() { subscribers.length = 0 },
  }
  const mockSimplePool = {
    subscribeMany: (_urls: string[], _filters: unknown[], opts: { onevent(e: unknown): void }) =>
      relayBus.subscribe((e) => opts.onevent(e)),
    publish: (_urls: string[], event: unknown) => relayBus.publish(event),
    close: () => {},
  }
  return { relayBus, mockSimplePool }
})

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>()
  return { ...actual, SimplePool: vi.fn(() => mockSimplePool) }
})
```

- [ ] **Step 4: Run all tests**

```bash
cd /home/mattthomson/workspace/qDHT && npx vitest run
```

Expected: all pass, including both integration tests (direct WS and relay).

- [ ] **Step 5: Commit**

```bash
git add src/node/integration.test.ts
git commit -m "test(integration): publish announcement via relay, receive on subscriber"
```

---

## Self-Review Checklist

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Extract `Transport` interface to `src/node/transport.ts` | Task 1 |
| `PeerManager` implements `Transport` | Task 2 |
| `SyncManager` accepts `Transport[]` | Task 3 |
| `RelayAdapter` in `src/node/relay-adapter.ts` using `SimplePool` | Task 6 |
| `relays[]` added to config schema | Task 5 |
| `QDHTNode` wires `RelayAdapter` when `config.relays` set | Task 7 |
| Integration test: relay publish/subscribe | Task 8 |
| `RelayAdapter.connect()` called from `start()` | Task 7 |
| `close()` calls `relayAdapter?.close()` | Task 7 |
| `onPeerConnected`/`onPeerDisconnected` no-op on relay (spec §2) | Task 6 — methods registered but not called |
| `excludePeerId` ignored in `RelayAdapter.broadcast` | Task 6 |
| Default filter covers kinds 10800–10803, 20800–20801 | Task 6 |
| `broadcast` is no-op for events missing `id`/`sig`/`pubkey` | Task 6 |

**Placeholder scan:** No TBDs or vague steps found.

**Type consistency:**
- `Transport` interface defined in Task 1 with exact method signatures used in Tasks 2, 3, 6, 7.
- `RelayAdapter` uses `Transport` from `./transport.js` — consistent path.
- `makeMockTransport()` in sync-manager tests returns a full `Transport` implementation.
- `config.relays` is `string[] | undefined` throughout — consistent with `QDHTConfig`.
