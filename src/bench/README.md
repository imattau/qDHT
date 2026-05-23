# `src/bench`

Benchmark harnesses for qDHT.

## Files

- `dht-benchmark.ts` compares qDHT against a libp2p Kad-DHT baseline
- `dht-benchmark.test.ts` smoke-tests the benchmark flow

## What it measures

- publish latency
- discovery latency
- coverage
- a JSON summary suitable for automation

## Caveat

The benchmark is useful for protocol-level comparison, but it is not a transport-equivalent benchmark. qDHT and the baseline are intentionally exercised through different runtime stacks to keep the comparison practical.
