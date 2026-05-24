# Peer Connection Policy — Design Spec

**Date:** 2026-05-24
**Status:** Approved for planning
**Feature:** Automated peer connection gating on receipt of kind 30181 (SERVICE_RECORD) events

---

## 1. Overview

When a regular qDHT node receives a kind `30181` (SERVICE_RECORD) event, it must decide whether to connect to the advertised peer endpoint. This spec defines `PeerDiscoveryPolicy`, a stateless class that owns all connection-gating logic, and the integration points in `SyncManager` and `QdhtNode`.

This is not a routing policy and not a disconnection policy — it gates only new outbound connections triggered by service record events.

---

## 2. Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `PeerDiscoveryPolicy` | Stateless. Owns all connection-gating logic. Returns a boolean. |
| `SyncManager` | Handles kind `30181` events. Extracts URL and advertiser pubkey. Calls policy. Calls `peerManager.connect(url)` if approved. |
| `PeerManager` | Provides idempotent `connect(url)`. Exponential backoff on reconnect. No changes required. |
| `ReputationMap` | Read-only input to policy. No changes required. |
| bootstrapMode nodes | Skip `PeerDiscoveryPolicy` entirely — guard with `if (bootstrapMode) return` before policy call in `SyncManager`. |

`PeerDiscoveryPolicy` is not responsible for:
- Disconnecting existing peers
- Routing decisions
- Reputation updates

---

## 3. Data Flow and Signatures

### New file: `src/node/peer-discovery-policy.ts`

```typescript
export interface ServiceRecord {
  url: string;
  advertiserPubkey: string;
}

export interface PeerDiscoveryPolicy {
  shouldConnect(
    record: ServiceRecord,
    currentPeers: PeerInfo[],
    reputationMap: ReputationMap,
    maxPeers: number
  ): boolean;
}
```

### Gate logic (in order, short-circuit)

1. `currentPeers.length >= maxPeers` → `false`
2. URL already present in `currentPeers` (exact match after normalisation) → `false`
3. `reputationMap.get(record.advertiserPubkey) < REPUTATION_CONNECT_THRESHOLD` → `false`
4. Otherwise → `true`

### SyncManager integration

`SyncManager` receives `PeerDiscoveryPolicy`, `PeerManager`, `ReputationMap`, and `maxPeers` via constructor injection.

On kind `30181`:

```typescript
case 30181: {
  if (bootstrapMode) return;
  const urlTag = event.tags.find(t => t[0] === 'url');
  if (!urlTag?.[1]) return; // no URL tag — skip silently
  let url: string;
  try {
    url = new URL(urlTag[1]).toString(); // normalise; throws on malformed
  } catch {
    return; // malformed URL — skip silently
  }
  if (url === this.ownUrl || event.pubkey === this.ownPubkey) return; // self-connect guard
  const record: ServiceRecord = { url, advertiserPubkey: event.pubkey };
  if (this.policy.shouldConnect(record, this.peerManager.currentPeers(), this.reputationMap, this.maxPeers)) {
    this.peerManager.connect(url);
  }
  break;
}
```

### QdhtNode changes

`QdhtNode` passes `PeerManager`, `PeerDiscoveryPolicy`, `ReputationMap`, and `maxPeers` into the `SyncManager` constructor.

---

## 4. Reputation Thresholds

```typescript
// src/node/peer-discovery-policy.ts
export const REPUTATION_CONNECT_THRESHOLD = -0.3;
```

- This is the first reputation threshold constant in the codebase. It lives in `peer-discovery-policy.ts` co-located with the logic that consumes it.
- Unknown node: `ReputationMap.get` returns `0` (neutral) → allowed.
- Drop threshold (disconnecting existing peers on reputation decay) is explicitly out of scope for this feature.

---

## 5. Error Handling

| Condition | Handling |
|-----------|----------|
| No `url` tag in event | Skip silently — `return` early |
| Self-connect (own pubkey or own URL) | Skip — guard before policy call |
| Malformed URL | `try/catch new URL()` → skip on `TypeError` |
| `bootstrapMode` | Guard with `if (bootstrapMode) return` before any policy call |
| Already-connected URL | `shouldConnect` returns `false` (URL set check, gate 2) |
| Volume / performance | `shouldConnect` is O(n) on peers list — acceptable at `maxPeers=50`. Callers should debounce by pubkey+URL before invoking if event fan-in is high. |

---

## 6. Key Files

| File | Change |
|------|--------|
| `src/node/peer-discovery-policy.ts` | **New.** `ServiceRecord` interface, `PeerDiscoveryPolicy` interface, `DefaultPeerDiscoveryPolicy` class, `REPUTATION_CONNECT_THRESHOLD` constant. |
| `src/node/sync-manager.ts` | Add `case 30181` handler. Inject `PeerDiscoveryPolicy`, `PeerManager`, `ReputationMap`, `maxPeers` via constructor. |
| `src/node/qdht-node.ts` | Pass `PeerManager`, `DefaultPeerDiscoveryPolicy`, `ReputationMap`, `maxPeers` into `SyncManager` constructor. |
| `src/core/protocol/reputation.ts` | Read-only. No changes. |
| `src/node/config.ts` | `maxPeers` already exists. No changes. |

---

## 7. Out of Scope

- Peer disconnection on reputation decay
- Drop threshold constant
- Inbound connection gating (this spec covers outbound only)
- Rate limiting or per-pubkey debounce (noted as caller responsibility)
- DHT-baseline or simulation changes

---

## 8. Open Questions

None — all design decisions resolved during brainstorm.
