# qDHT Simulation Library Design

**Date**: 2026-05-23
**Phase**: 1 — Simulation Library (`qdht-sim-ts`)

---

## Purpose

Prove the qDHT model before adding networking complexity. A deterministic, 500-node TypeScript simulation that measures announcement propagation, replica creation, delta catch-up, piece swarming, churn recovery, and spam suppression — compared against a Kademlia baseline under identical conditions.

---

## Core Design Decisions

### Quantum Walk Computation
Pluggable behind a shared `GraphState` interface. Automatic threshold: Jacobi eigendecomposition for graphs ≤128 nodes (exact), truncated Taylor expansion of `exp(-iLt)` for larger graphs (approximate). Both behind the same `Amplitude(i, s, t)` call. Ported directly from the Quantum Relay Go implementation (`rely/internal/quantum/`).

### Time Model
Tick-based. A single integer `round` counter is the only clock. The runner advances all nodes one tick at a time. Deterministic replay and churn control (node goes offline at tick N) are trivial. Matches rely's proven `Propagator.Tick(currentRound, gamma)` pattern.

### Graph Topology
Factory pattern. Scenarios declare topology at construction:
- `Topology.erdosRenyi({ n, p })` — random graph with edge probability p
- `Topology.barabasiAlbert({ n, m })` — scale-free, power-law degree distribution
- `Topology.fromAdjacency(matrix)` — explicit, for unit tests

### Transport
In-process message queues with mandatory JSON round-trip. Each node has an inbox. The runner delivers messages by serialising to JSON and deserialising on receipt — identical code path to a real socket, same message shapes, but deterministic delivery. The seam where a real WebSocket transport plugs in (Phase 3) is a single `Transport` interface swap.

---

## Package Structure

```
src/
  core/                         # pure qDHT logic, no sim concerns
    graph/
      graph-state.ts            # GraphState: Amplitude(), Recompute(), SetConnection()
      topology.ts               # topology factory
      laplacian.ts              # matrix ops (Jacobi, Taylor expansion)
    protocol/
      announcement.ts           # QDHTAnnouncement shape + builder (kind 10800)
      replica-record.ts         # QDHTReplicaRecord shape + builder (kind 10801)
      delta.ts                  # DeltaRequest (20800) / DeltaResponse (20801)
      reputation.ts             # ReputationFactor pure fn + local score map
      piece-manifest.ts         # PieceManifest shape (kind 10803)
    propagation/
      propagator.ts             # Propagator: AddNote(), Tick(), threshold, exploration floor
      strategy.ts               # PropagationStrategy interface
      strategies/
        flood.ts
        random-gossip.ts
        quantum-topk.ts
    content/
      provider.ts               # ContentProvider interface
      replica-store.ts          # which pieces a node holds
      piece-fetcher.ts          # piece selection logic (rare-first, reputation-weighted)
    neighbour-state.ts          # AnnouncementNeighbourState per key

  sim/
    node/
      sim-node.ts               # SimNode: wraps core primitives + sim lifecycle
      inbox.ts                  # in-process message queue with JSON round-trip
    runner/
      simulation.ts             # Simulation: owns nodes + shared GraphState, drives ticks
      metrics.ts                # per-tick metric collection + aggregation
      churn.ts                  # churn schedule: offline/online events keyed by tick
      report.ts                 # side-by-side report formatter
    scenarios/
      stable.ts
      churn.ts
      spam.ts
      swarming.ts
      dht-baseline.ts           # Kademlia baseline, same metric schema
```

`src/core/` has no dependency on `src/sim/`. It is importable by a browser, CLI node, or simulation without modification. This is the code the live node (Phase 3) will use directly.

---

## SimNode Structure

```ts
class SimNode {
  id: string                                          // hex node ID (no real crypto in sim)
  online: boolean                                     // churn toggle
  offlineSince: number | null                         // tick went offline; triggers delta catch-up on rejoin

  // core primitives
  propagator: Propagator                              // shared GraphState injected at construction
  neighbourState: Map<string, AnnouncementNeighbourState>
  replicaStore: ReplicaStore
  reputationMap: Map<string, number>                  // local scores for peers

  // sim-only
  inbox: Inbox                                        // in-process message queue
  metrics: NodeMetrics                                // per-tick counters
}
```

### Tick sequence (per round)

1. Runner advances churn schedule (toggle `online` flags)
2. For each online node: drain inbox, process messages, call `propagator.tick(round, gamma)`
3. Nodes that just rejoined (`offlineSince !== null`) send `DeltaRequest` to online neighbours
4. Neighbours respond with `DeltaResponse` (missed announcements/replicas/reputation since `offlineSince`)
5. Runner collects per-node metrics

Offline nodes do not receive inbox messages. Messages sent to offline nodes are dropped (configurable: queue or drop).

---

## Metrics

Collected per tick, aggregated at scenario end:

| Metric | Description |
|---|---|
| `coverage` | % of interested nodes that received the announcement |
| `interestedDelivery` | % delivered to nodes that later fetched content |
| `announcementBandwidth` | total announcement messages sent |
| `contentBandwidth` | total content/piece bytes transferred |
| `sourceBandwidth` | bytes served by the original source node |
| `replicaCount` | mean replicas per key across network |
| `nearestReplicaDistance` | mean graph-hop distance to nearest replica |
| `churnRecoveryRate` | % of offline nodes that recovered full state on rejoin |
| `spamSuppressionRate` | % of spam announcements dropped before propagation |

---

## Scenarios

### `stable`
500 nodes, Barabási–Albert topology (m=3), no churn. Measures steady-state propagation coverage and replica distribution.

### `churn`
500 nodes, 20% of nodes cycling offline/online on a random schedule. Measures delta catch-up effectiveness and announcement recovery rate.

### `spam`
500 nodes, 10% adversarial nodes publishing high-volume invalid announcements. Measures spam suppression via reputation damping.

### `swarming`
200MB content split into 512 pieces, 500 nodes, source serves initial seed only. Measures source bandwidth reduction, parallel fetch efficiency, piece distribution.

### `dht-baseline`
Simplified Kademlia on the same topology and traffic pattern. What it implements:
- 160-bit XOR keyspace node IDs
- k=20 buckets, α=3 parallel lookup concurrency
- Iterative `FIND_NODE` / `STORE` / `FIND_VALUE`
- Republish every 60 ticks; bucket refresh every 30 ticks

Outputs the same metric schema. Produces a side-by-side comparison report.

---

## Scenario API

```ts
const sim = new Simulation({
  nodes: 500,
  topology: Topology.barabasiAlbert({ m: 3 }),
  propagation: 'quantum-topk',
  gamma: 0.5,
  tickCount: 1000,
})

sim.on('tick', (round, metrics) => { ... })
await sim.run()
const report = sim.report()
```

---

## npm Scripts

```bash
npm run build
npm run test
npm run test -- <file>         # single test file
npm run sim:stable
npm run sim:churn
npm run sim:spam
npm run sim:swarm
npm run sim:dht-baseline
```

---

## What Is Ported from Quantum Relay

| Component | rely source | qDHT target |
|---|---|---|
| `GraphState` (Amplitude, Recompute, Jacobi, Taylor) | `internal/quantum/graph.go` | `src/core/graph/graph-state.ts` |
| `Propagator` (Tick, AddNote, threshold, exploration floor) | `internal/quantum/walk.go` | `src/core/propagation/propagator.ts` |
| `ReputationFactor` | `internal/quantum/damping.go` | `src/core/protocol/reputation.ts` |
| Reputation diffusion (`Diffuser`) | `internal/consensus/diffuser.go` | `src/core/protocol/reputation.ts` |

All ported code adapts Go concurrency primitives to single-threaded TypeScript. Mutex locks become direct property access; goroutines become async functions or synchronous tick processing.

---

## What Is New (not in Quantum Relay)

- `AnnouncementNeighbourState` — per-key inbound/outbound neighbour tracking
- `ReplicaStore` — piece availability bitmap per content key
- `DeltaRequest` / `DeltaResponse` — catch-up protocol
- `PieceFetcher` — rare-first, reputation-weighted piece selection
- Simulation runner with tick-driven churn and metric collection
- Kademlia baseline
- Topology factory (Erdős–Rényi, Barabási–Albert)
- In-process JSON transport with socket-identical framing
