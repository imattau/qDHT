# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

qDHT is a Nostr-compatible content discovery layer where signed announcements propagate across overlapping local peer graphs, creating local neighbour-state that enables global retrieval without global routing tables. Large content is fetched separately from nearby replicas using reputation-aware, piece-based swarming.

It is **not** classical keyspace query routing. The core insight: **qDHT turns propagation history into routing state.**

## Architecture Layers

```
Application Layer     PUT / GET / SUBSCRIBE, content publishing
qDHT Protocol Layer   announcements, replica records, neighbour-state, delta sync, reputation
Transfer Layer        HTTP / NIP-96, WebRTC, BitTorrent, local TCP, piece swarming
Nostr Primitive Layer keys, signed events, tags, relays, encrypted control messages
```

## Nostr Primitive Reuse

qDHT builds on Nostr rather than reinventing identity, signing, or event format:

- **Node identity**: secp256k1 keypairs (Nostr pubkeys as node IDs)
- **Event structure**: NIP-01 signed events with `pubkey`, `created_at`, `kind`, `tags`, `content`, `sig`
- **File metadata**: NIP-94 style (kind `1063`) for content hash, URL, MIME, size
- **File storage**: NIP-96 HTTP upload/reference pattern
- **Encryption**: NIP-44 for private control payloads; NIP-59 gift-wrap for private replica sharing
- **Libraries**: `nostr-tools`, `@noble/secp256k1`

## Custom qDHT Event Kinds

| Kind    | Name                  | Purpose                                    |
|---------|-----------------------|--------------------------------------------|
| `30180` | qDHT Node Profile     | Node capabilities                          |
| `30181` | qDHT Service Record   | Peer endpoint / relay / transport info     |
| `10800` | qDHT Announcement     | Announces key/content availability         |
| `10801` | qDHT Replica Record   | Declares available replica or pieces       |
| `10802` | qDHT Reputation Delta | Reputation update                          |
| `10803` | qDHT Piece Manifest   | Piece hash/size/provider metadata          |
| `20800` | qDHT Delta Request    | Rejoin/catch-up request                    |
| `20801` | qDHT Delta Response   | Recent announcements/replicas/reputation   |
| `20802` | qDHT Probe / Ping     | Lightweight liveness                       |
| `20803` | qDHT Fetch Hint       | Nearby replica/piece hint                  |

MVP needs only: `10800`, `10801`, `10802`, `10803`, `20800`, `20801`.

## Key Architectural Concepts

### Local Neighbour-State (core routing mechanism)
Each node maintains `AnnouncementNeighbourState` per key: maps of inbound and outbound neighbours with probability, reputation, replica availability, and latency. Retrieval queries this state — "which neighbour most likely leads to a replica?" — creating emergent global routing from overlapping local views.

### Propagation Strategy
Pluggable via `PropagationStrategy` interface. The quantum-overlap strategy:
1. Build local 1-hop ego graph
2. Compute bare Laplacian L
3. Compute CTQW probability: `prob(i) = |<i| exp(-iLΔt) |source>|²`
4. Apply reputation damping: `effective_prob = quantum_prob × reputation_factor`
5. Select top-k targets with exploration floor

### Content / Piece Model
Large content never goes into qDHT events. Use `ContentProvider` interface with local filesystem, HTTP, and NIP-96 providers. Piece swarming: prefer nearby/high-reputation replicas, rare pieces first, verify every piece hash, only reassemble if root hash matches.

### Delta Catch-Up (churn repair)
On rejoin, a node sends `DeltaRequest` (kind `20800`) with `since` timestamp to neighbours. Response (`20801`) returns missed announcement/replica/reputation event IDs. MVP sends full event objects; later optimise with Bloom filters or Merkle summaries.

### Reputation
Local-first score (-1 to +1) per node. Negative triggers: bad hash, missing pieces, spam, invalid sig, timeout. Positive: valid content served, fast delivery, stable uptime. Damping: `reputation_factor = exp(-2γ|rep|t)` for negative scores.

## Repository Structure (target layout)

```
src/
  identity/       keys.ts, signing.ts
  nostr/          event.ts, kinds.ts, tags.ts, relay-adapter.ts
  graph/          graph.ts, local-ego.ts, laplacian.ts, quantum-walk.ts
  protocol/       announcement.ts, replica.ts, delta.ts, reputation.ts, neighbour-state.ts
  propagation/    strategy.ts, flood.ts, random-gossip.ts, quantum-overlap.ts, quantum-topk.ts
  content/        provider.ts, local-store.ts, http-provider.ts, nip96-provider.ts, pieces.ts, swarm-fetcher.ts
  node/           qdht-node.ts, peer-manager.ts, sync-manager.ts
  sim/            scenarios/ (stable, churn, spam, swarming, dht-baseline), metrics.ts, runner.ts
test/
```

## Development Phases

1. **Simulation library** (`qdht-sim-ts`) — 500-node deterministic graph, no networking, proves model first
2. **Nostr event layer** — key gen, signing, verification, qDHT kinds, tag filtering
3. **Live node** (`qdht-node`) — CLI: `put`, `get`, `peers`, `replicas <key>` over WebSocket/TCP
4. **Relay adapter** — publish/subscribe qDHT event kinds through existing Nostr relays
5. **Content providers** — filesystem, HTTP, NIP-96, piece fetcher
6. **Adversarial simulations** — spam publisher, bad hash provider, fake replica, churn attack
7. **DHT baseline** — simplified Kademlia for comparison (required before making performance claims)

## Build & Test Commands

The project uses TypeScript/Node.js. Commands will follow this pattern once `package.json` is established:

```bash
npm run build          # compile TypeScript
npm run test           # all tests
npm run test -- <file> # single test file
npm run sim:stable     # stable network scenario
npm run sim:churn      # churn scenario
npm run sim:spam       # spam suppression scenario
npm run sim:swarm      # piece swarming scenario
npm run sim:dht-baseline  # Kademlia comparison baseline
```

Simulation output metrics: coverage, interested delivery, announcement bandwidth, content bandwidth, source bandwidth, replica count, nearest-replica distance, churn recovery rate, spam suppression rate.

## What Is Custom vs Reused

**Reuse from Nostr**: key generation, event signing, event IDs, tags, relay message formats, NIP-94 file metadata, NIP-96 file storage, NIP-44 encryption, NIP-59 wrapping, existing WebSocket relay code, secp256k1 libs.

**Custom to qDHT**: local graph propagation, quantum-overlap scoring, neighbour-state storage, replica scoring, delta catch-up logic, reputation damping, piece-swarming provider selection, churn repair, simulation metrics.
