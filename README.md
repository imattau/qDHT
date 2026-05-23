# qDHT

qDHT is a Nostr-shaped distributed hash table for identity discovery, route discovery, announcement propagation, and content distribution.

It is not trying to be a generic key/value DHT. The design is centered on signed announcements, metadata search, route reflection, and content pointers rather than raw distributed storage of arbitrary records.

It is organized around a few bounded layers:

- `src/core` for protocol, identity, graph, discovery, and content primitives
- `src/node` for the live node runtime, CLI, transports, and persistence
- `src/sim` for the simulation harness and comparison scenarios
- `src/bench` for qDHT vs baseline benchmark runs
- `examples` for runnable demos

## How It Works

At a high level:

1. A node publishes signed announcements for content, routes, replicas, or requests.
2. Those announcements propagate through the network and are persisted locally.
3. Identity lookups resolve a pubkey or Nostr reference to a route announcement.
4. Metadata searches return matching announcements, route records, or replica hints.
5. Content fetches use the announcement metadata to locate providers or replicas.
6. The node falls back across WebSocket, relay, and QUIC transports as needed.

This makes qDHT useful as both a discovery layer and a distribution layer.

## What it does

- Announces and discovers content metadata
- Resolves Nostr identities to routeable endpoints
- Stores content locally and fetches from providers or replicas
- Supports WebSocket, relay, and QUIC transports
- Provides a simulation layer for churn, spam, and baseline comparison

## How qDHT Differs From a Standard DHT

| Topic | Standard DHT | qDHT |
| --- | --- | --- |
| Primary unit | Key/value record | Signed announcement |
| Identity model | Usually network node IDs only | Nostr pubkeys and Nostr identity references |
| Search model | Exact key lookup | Metadata and route lookup |
| Content model | Often stores pointers or provider records | Stores content announcements, replicas, manifests, and provider hints |
| Routing model | Mostly overlay routing for key lookup | Discovery plus route reflection plus transport fallback |
| Transport layer | Typically one stack per implementation | WebSocket, relay, and QUIC can coexist |
| Search surface | Usually bounded to keys and provider records | Bounded request announcements over metadata and routes |
| Content bytes | Usually external to the DHT | Still external; fetched from providers or replicas |
| NAT handling | Often implicit or out-of-band | Observed address reflection and relay fallback are first-class |
| Searchability | Typically not the main goal | Metadata search is a first-class feature |

## What It Is Not

- It is not a full-text search engine for raw content.
- It is not a generic distributed database for arbitrary records.
- It is not a replacement for content stores or object storage.
- It is not a production proof of superiority over Kademlia.
- It is not a promise that every node is always directly reachable.

## Getting Started

Install dependencies and run the test suite:

```bash
npm install
npm test
```

Run the live node CLI:

```bash
npm run node:start
```

## Common Commands

- `npm run node:start` start the daemon
- `npm run example:hello` run the simplest publish/get demo
- `npm run example:reachability` run the DNS-less identity-to-route demo
- `npm run example:spam` run the spam-filter comparison demo
- `npm run bench:dht` compare qDHT against the libp2p Kad-DHT baseline
- `npm run stress:quic` run the QUIC live-node stress harness

## Documentation Map

- [`src/core/README.md`](src/core/README.md)
- [`src/node/README.md`](src/node/README.md)
- [`src/sim/README.md`](src/sim/README.md)
- [`src/bench/README.md`](src/bench/README.md)
- [`bin/README.md`](bin/README.md)
- [`examples/README.md`](examples/README.md)

## Core Concepts

- `announcement`: a signed event that says something exists, such as a file, replica, or route
- `request announcement`: a signed metadata query asking the network for matching pointers or routes
- `response announcement`: a signed metadata reply containing matching announcements or route records
- `route announcement`: a signed endpoint record that helps turn an identity into a dialable target
- `replica record`: a signed note that a peer has part or all of a content item
- `provider`: something that can supply the actual bytes for a content item
- `content store`: local on-disk storage for pieces and indexes
- `search`: metadata lookup over announcements and routes, not arbitrary raw content
- `transport`: the live network path used to carry events between nodes

## Status

The repo currently includes:

- simulation coverage for stable, churn, spam, swarming, and baseline cases
- a live node with CLI, WebSocket, relay, and QUIC transports
- SQLite-backed Nostr event persistence
- content-provider and reachability examples
- benchmark and stress harnesses

## Recommended Reading Order

1. [`src/core/README.md`](src/core/README.md)
2. [`src/node/README.md`](src/node/README.md)
3. [`examples/README.md`](examples/README.md)
4. [`src/sim/README.md`](src/sim/README.md)
5. [`src/bench/README.md`](src/bench/README.md)
