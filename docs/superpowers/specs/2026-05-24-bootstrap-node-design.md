# Bootstrap Node Design

**Date:** 2026-05-24
**Status:** Approved for implementation
**Scope:** Stable rendezvous node for new-peer discovery in qDHT

---

## Overview

A bootstrap node is a long-lived, publicly reachable qDHT node whose sole job is:
1. Passively accumulating and redistributing kind `30181` (Service Record) events so new peers can discover each other.
2. Reflecting each peer's observed public IP/port back to them (STUN-like, using existing kind `30800`).

It does **not** participate in content routing, propagation, or reputation. It is a thin wrapper around a minimal subset of `QDHTNode` capabilities.

---

## Approach: Thin Wrapper

`QDHTNode` gains a `bootstrapMode` flag. When `true`, subsystems not needed for rendezvous are skipped at startup. A new `BootstrapService` class handles all bootstrap-specific logic. Normal nodes are unaffected by the flag's absence.

---

## Section 1 — Configuration (`src/node/config.ts`)

### New fields on `QDHTConfig`

```ts
bootstrapMode?: boolean   // default false
maxPeers?: number         // max simultaneous WebSocket connections; only enforced in bootstrapMode
```

### CLI flag

`--bootstrap` sets `bootstrapMode: true` in `ConfigOverrides`. The CLI flag takes precedence over the config file field.

### Validation (`validateConfig`)

- Both fields are optional; absence is valid.
- `maxPeers`, if present, must be a positive integer (`> 0`, no fractional values).
- `bootstrapMode: true` without `maxPeers` is legal; the implementation uses a sensible default (10,000).

---

## Section 2 — `QDHTNode` Changes (`src/node/qdht-node.ts`)

### Subsystems skipped when `bootstrapMode: true`

The following are **not** instantiated or started:

- `Propagator`
- `ReplicaStore`
- `ReputationMap`
- `ContentProviderRegistry`

### Subsystems kept

- `PeerManager` (WebSocket server, connection tracking)
- Config loading and signal handling (SIGINT/SIGTERM)

### Delta catch-up

A bootstrap node responds to `DELTA_REQUEST` (kind `20800`) using its peer list as the source of known events, and sends `DELTA_RESPONSE` (kind `20801`). This keeps rejoining peers functional without a full routing node.

### Guard pattern

Every subsystem that must not run in bootstrap mode is wrapped:

```ts
if (!this.config.bootstrapMode) {
  // instantiate and start subsystem
}
```

---

## Section 3 — `BootstrapService` (new file: `src/node/bootstrap-service.ts`)

### Responsibilities

1. Maintain an LRU cache of kind `30181` events, keyed by `pubkey`.
2. On new peer connect: send full cache contents, then reflect the peer's observed address.
3. On receiving `30181`: validate, deduplicate, upsert, rebroadcast.
4. On disconnect: remove the peer's own `30181` from the cache.
5. Periodically evict expired entries.
6. Enforce `maxPeers` at upgrade time.

### Cache

```
Map<pubkey: string, SignedNostrEvent>
```

Maximum size: `config.maxPeers ?? 10_000`. When the cache reaches capacity, the oldest entry by `created_at` is evicted before inserting a new one (LRU by event age, not connection time).

### On new peer connect

1. Send each cached `30181` event to the new peer in insertion order.
2. Construct and send a kind `30800` event whose `content` is `req.socket.remoteAddress` (the observed public IP). This is the STUN-like reflection step.

### On receiving a kind `30181` from a peer

1. Call `isSignedEvent` to verify the signature. Drop silently on failure.
2. Check the `expiration` tag (if present); discard immediately if `created_at + expiration <= now`.
3. Check own pubkey: if `event.pubkey === this.node.pubkey`, discard (do not cache own record).
4. Upsert into cache only if `event.created_at > cached.created_at` (strictly newer). Discard duplicates and stale replacements with no rebroadcast.
5. Broadcast the event to all **other** currently connected peers.

### On disconnect

Remove the disconnected peer's entry from the `30181` cache (keyed by pubkey). This keeps the cache fresh and reflects current liveness.

### Eviction timer

A periodic timer (suggested: every 60 seconds) scans the cache and removes any entry whose `expiration` tag has passed.

### `maxPeers` enforcement

Applied at the WebSocket `upgrade` event, before the handshake completes:

- If `currentPeers.size >= maxPeers`, send a close frame with:
  - Close code: `1008` (policy violation)
  - Structured payload: `{ type: "FULL", maxPeers: N }`
- Do not instantiate the connection.

### IP reflection (kind `30800`)

Kind `30800` (`observed_address`) already exists in `NOSTR_KIND_ROWS` in `src/core/nostr/kinds.ts`. No new kind is needed. The bootstrap node signs and sends a `30800` event per connection containing the peer's observed remote address.

---

## Section 4 — All nodes publish `30181` on connect (prerequisite)

This section describes changes to normal (non-bootstrap) node behaviour that must land before or alongside `BootstrapService`.

### `kinds.ts` additions (`src/core/nostr/kinds.ts`)

Add to `QDHT_KIND`:

```ts
NODE_PROFILE: 30180,
SERVICE_RECORD: 30181,
```

Add corresponding rows to `QDHT_KIND_ROWS`:

```ts
{ kind_id: 30180, name: 'node_profile',   category: 'routing', searchable: 1, description: 'Node capability profile' },
{ kind_id: 30181, name: 'service_record', category: 'routing', searchable: 1, description: 'Peer endpoint and transport info' },
```

### `PeerManager` change (`src/node/peer-manager.ts`)

In the `peer-connected` handler, after a successful connection:

1. Check `config.listenAddress`. If absent, emit a one-time startup warning (`warn: listenAddress not set; skipping 30181 publish`) and skip.
2. Construct a kind `30181` event:
   - `pubkey`: this node's pubkey
   - `content`: `""` (empty; metadata in tags)
   - `tags`: `[["transport","ws"], ["d","main"], ["url", config.listenAddress]]`
   - `created_at`: current unix timestamp
3. Sign with this node's private key.
4. Send to the newly connected peer.

Kind `30181` is in the replaceable range (30000–39999). The `d`-tag value `"main"` ensures only the latest record is kept by peers implementing NIP-01 replaceable logic.

---

## Section 5 — Error Handling

| Situation | Behaviour |
|---|---|
| Own pubkey in received `30181` | Discard; do not cache or rebroadcast |
| Invalid or unsigned `30181` | Drop silently after `isSignedEvent` fails; do not disconnect peer |
| Expired `expiration` tag on receipt | Discard immediately; no cache update |
| `maxPeers` reached | Structured rejection: close code `1008`, payload `{ type: "FULL", maxPeers: N }` |
| No `listenAddress` configured | Skip `30181` publish; emit one-time warning at startup |
| Bootstrap node restarted | Cache starts empty; peers naturally re-announce their `30181` on reconnect |
| Duplicate `30181` (same pubkey, same or older `created_at`) | Discard; no rebroadcast |
| Unknown event kind received at bootstrap node | Ignore; bootstrap handles only `30181` and delta catch-up (`20800`/`20801`) |
| Peer disconnects | Remove their `30181` from cache |

---

## Files Affected

| File | Change |
|---|---|
| `src/node/config.ts` | Add `bootstrapMode?`, `maxPeers?` to `QDHTConfig`; update `validateConfig` |
| `src/node/qdht-node.ts` | Guard subsystem init/start behind `if (!bootstrapMode)`; handle delta catch-up in bootstrap mode |
| `src/node/peer-manager.ts` | Publish signed `30181` on peer connect (line 84 area, after `remoteAddress` access) |
| `src/node/bootstrap-service.ts` | **New file.** Full implementation of `BootstrapService` as described above |
| `src/core/nostr/kinds.ts` | Add `NODE_PROFILE` (30180) and `SERVICE_RECORD` (30181) to `QDHT_KIND` and `QDHT_KIND_ROWS` |

---

## Out of Scope

- Persistent cache across restarts (by design: restart is a clean slate).
- DHT-level routing participation by the bootstrap node.
- Authentication or authorisation of bootstrap clients beyond signature verification.
- Bloom filter or Merkle optimisation of delta catch-up (deferred to a later phase per the architecture plan).
