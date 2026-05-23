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

## Outputs

Scenarios print human-readable summaries and metrics such as coverage and bandwidth.
