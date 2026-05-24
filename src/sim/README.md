# `src/sim`

Simulation harness for qDHT behavior and comparison scenarios.

## Files

- `node/` contains the simulated node and inbox model
- `runner/` contains the simulation engine, churn, metrics, and report helpers
- `scenarios/` contains runnable scenario scripts

## Scenarios

- `stable.ts`
- `churn.ts`
- `spam.ts`
- `swarming.ts`
- `dht-baseline.ts`

## What it is for

The simulation layer lets qDHT be exercised without standing up live network processes. It is used for:

- propagation checks
- churn recovery checks
- spam suppression checks
- swarming checks
- comparisons against a Kademlia-style baseline

## How the Simulator Works

The simulator constructs an in-memory graph of nodes. Each node has a `PropagationStrategy` (quantum-overlap by default), a `NeighbourStateMap`, and a `ReputationMap`. There is no real networking: message delivery is synchronous within each tick.

Each simulation tick:

1. `MetricsCollector.startTick(round)` — opens a new per-round snapshot.
2. The scenario publishes announcements, injects churn events, or introduces spam according to its script.
3. The propagator selects targets using CTQW probabilities and reputation weights, then delivers messages to selected neighbours.
4. `MetricsCollector` records bandwidth counters, replica counts, and delivery events.
5. `MetricsCollector.endTick(round)` — closes the snapshot.

After all ticks, `runner/report.ts` aggregates snapshots into summary statistics.

## Running Scenarios

| Scenario | Command | What it tests |
|---|---|---|
| `stable.ts` | `npm run sim:stable` | Steady-state coverage and bandwidth on a 500-node network with no churn |
| `churn.ts` | `npm run sim:churn` | Delta catch-up effectiveness when nodes leave and rejoin |
| `spam.ts` | `npm run sim:spam` | Reputation damping suppressing a flood publisher while legitimate traffic continues |
| `swarming.ts` | `npm run sim:swarm` | Piece-based content distribution across replica nodes |
| `dht-baseline.ts` | `npm run sim:dht-baseline` | Kademlia-style comparison baseline on the same graph topology |

## Metrics

`runner/metrics.ts` tracks the following per tick:

| Metric | Type | Description |
|---|---|---|
| `announcementBandwidth` | count | Announcement messages sent across all edges this tick |
| `contentBandwidth` | bytes | Content bytes transferred via replica fetches |
| `sourceBandwidth` | bytes | Content bytes served from the original source node |
| `replicaCount` | count | Nodes holding at least one replica at end of tick |
| Delivery rate | ratio | `delivered / interested` — fraction of interested nodes that received the announcement |

Coverage and delivery rate are tracked per-key. `setInterestedNodes(key, nodes)` marks which nodes care about a key before propagation begins; delivery is recorded as each interested node receives the announcement.

## Reading the Output

`runner/report.ts` prints a table with one row per tick and a summary block:

```
round  ann_bw  content_bw  source_bw  replicas  delivery%
    1     120           0          0         1      12.4%
    2      98       40960      40960         4      31.7%
  ...
Summary:
  peak delivery   : 94.2% (round 18)
  mean ann_bw/tick: 87
  total replicas  : 12
  spam suppression: 96.1%   (spam scenario only)
```

`ann_bw` is a message count, not bytes. `delivery%` is the fraction of interested nodes reached by end of that tick.

## Writing a New Scenario

1. Create a file in `src/sim/scenarios/`.
2. Import `Simulation` from `../runner/simulation.js` and `MetricsCollector` from `../runner/metrics.js`.
3. Construct a `Simulation` with a node count and edge probability.
4. Call `sim.run(rounds, scenarioHook)` where `scenarioHook` receives `(round, metrics)` and drives announcements, churn, or content operations.
5. Pass the final `MetricsCollector` to `report.printReport`.
