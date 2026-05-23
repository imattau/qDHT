# Relay Adapter Design — Phase 4

**Date:** 2026-05-23  
**Status:** Draft

## Overview

Add a Nostr-relay transport layer to qDHT so nodes can discover and sync with peers they cannot reach via direct WebSocket (NAT, firewalls, mobile). A pluggable `Transport` interface is extracted from `PeerManager`; a new `RelayAdapter` implements that interface using `nostr-tools` `SimplePool`. `SyncManager` is refactored to accept `Transport[]` so both transports operate in parallel without knowing about each other.

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| Q1 — Pluggable transport shape | Option A: shared `Transport` interface, both implementations implement it, `SyncManager` uses `Transport[]` | Clean contract, testable in isolation |
| Q2 — Relay client library | `nostr-tools` `SimplePool` (already a dependency) | No new dep, proven in Phase 2 |
| Q3 — Connection persistence | Persistent subscription with reconnect | Continuous event stream needed for node discovery |
| Q4 — Filter scope | Configurable filter; default covers qDHT kinds | Transport interface is general; caller supplies filter |

## Architecture

```
QdhtNode
  ├── PeerManager          (implements Transport — direct WS peers)
  ├── RelayAdapter         (implements Transport — Nostr relay)
  └── SyncManager(transports: Transport[])
```

`SyncManager` fans all outbound messages to every transport and aggregates inbound messages from all transports through a single `handleMessage` entry point. Neither transport knows the other exists.

## 1. Transport Interface

**File:** `src/node/transport.ts` (new)

```ts
export interface Transport {
  /** Register a handler for all inbound messages from this transport. */
  onMessage(handler: (msg: unknown, peerId: string) => void): void

  /** Register a handler called when a peer becomes available on this transport. */
  onPeerConnected(handler: (peerId: string) => void): void

  /** Register a handler called when a peer disappears from this transport. */
  onPeerDisconnected(handler: (peerId: string) => void): void

  /** Send msg to all peers on this transport, optionally excluding one peer. */
  broadcast(msg: unknown, excludePeerId?: string): void

  /** Send msg to a specific peer on this transport. */
  send(peerId: string, msg: unknown): void

  /** Tear down all connections. */
  close(): Promise<void>
}
```

`PeerManager` adds `implements Transport` — it already satisfies every method. No logic changes.

## 2. RelayAdapter

**File:** `src/node/relay-adapter.ts` (new)  
**Test file:** `src/node/relay-adapter.test.ts` (new)

### Construction

```ts
export interface RelayAdapterOptions {
  privkey: string          // for signing — not stored, passed through
  relayUrls: string[]      // one or more wss:// URLs
  filter?: NostrFilter     // defaults to qDHT kinds
}
```

Default filter:

```ts
const DEFAULT_FILTER: NostrFilter = {
  kinds: [10800, 10801, 10802, 10803, 20800, 20801],
}
```

### Lifecycle

- `constructor` creates a `SimplePool` instance but does not connect.
- `connect(): Promise<void>` opens a `pool.subscribeMany(relayUrls, [filter], { onevent })` subscription. The subscription object is stored for teardown.
- `close()` calls `sub.close()` then `pool.close(relayUrls)`.
- `QdhtNode` calls `connect()` after construction, before returning from `start()`.

### Message handling

Incoming `onevent` callback:

1. If `event.kind` is not in `[10800, 10801, 10802, 10803, 20800, 20801]` — drop.
2. Parse and forward the raw event object to all registered `onMessage` handlers with `event.pubkey` as `peerId`.

### Publishing

`broadcast(msg)` and `send(peerId, msg)`:

- Both expect `msg` to be a fully-signed `NostrEvent` (same object that `SyncManager` already constructs before calling `broadcast`).
- Call `pool.publish(relayUrls, msg as NostrEvent)`.
- `excludePeerId` is ignored — relay routing has no direct-exclusion mechanism.
- If `msg` fails a basic shape check (`id`, `sig`, `pubkey` present), the call is a no-op.

### Peer lifecycle

`onPeerConnected` and `onPeerDisconnected` handlers are registered but not called in the initial implementation. Relay transports do not have session-level peer presence. This is a known limitation: `SyncManager.onPeerConnected` (which sends a delta request) will only fire for direct-WebSocket peers.

Future: a node that sees a new pubkey via a relay event could synthesise a `peerConnected` notification to trigger a delta request back through the relay.

## 3. SyncManager Changes

### Options type

Replace the two loose function props with a typed array:

```ts
// Before
broadcast: (msg: unknown, excludePeerId?: string) => void
send: (peerId: string, msg: unknown) => void

// After
transports: Transport[]
```

### Constructor wiring

```ts
for (const t of opts.transports) {
  t.onMessage((msg, peerId) => this.handleMessage(msg, peerId))
  t.onPeerConnected((peerId) => this.onPeerConnected(peerId))
  t.onPeerDisconnected((peerId) => this.peerLastSeen.delete(peerId))
}
```

### Broadcast / send helpers

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

`send` fans to all transports; each transport silently ignores unknown peer IDs. This is correct — a peerId from the relay transport will not be in `PeerManager`'s map and vice versa.

## 4. Config Changes

### schema addition (`src/node/config.ts`)

```ts
export interface NodeConfig {
  // ... existing fields ...
  relays?: string[]   // optional list of wss:// relay URLs
}
```

Default: `undefined` (no relay transport created).

### config.json example

```json
{
  "port": 8080,
  "peers": [],
  "relays": [
    "wss://relay.damus.io",
    "wss://nos.lol"
  ]
}
```

### QdhtNode wiring

```ts
const transports: Transport[] = [this.peerManager]
if (config.relays && config.relays.length > 0) {
  const relay = new RelayAdapter({
    privkey: config.privkey,
    relayUrls: config.relays,
  })
  await relay.connect()
  this.relayAdapter = relay   // stored for close()
  transports.push(relay)
}
this.syncManager = new SyncManager({ ...opts, transports })
```

`QdhtNode.close()` calls `this.relayAdapter?.close()`.

## Testing

- `relay-adapter.test.ts`: mock `SimplePool` with a jest/vitest manual mock. Verify `connect()` subscribes with the correct filter, `broadcast` publishes to all relay URLs, `close()` tears down the subscription.
- `sync-manager.test.ts`: existing tests updated to pass `transports: [mockTransport]` instead of bare function props. Add a test with two mock transports to verify fan-out.
- `integration.test.ts`: no relay URL configured — existing tests unaffected.

## Out of Scope

- NIP-42 relay authentication
- Relay health / failover selection
- Synthesised `peerConnected` events from relay-seen pubkeys
- Publishing to relay from the ephemeral mode (Phase 3 sim)
