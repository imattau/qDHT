# qDHT

qDHT is a Nostr-shaped distributed hash table for identity discovery, route discovery, announcement propagation, and content distribution.

It is not trying to be a generic key/value DHT. The design is centered on signed announcements, metadata search, route reflection, and content pointers rather than raw distributed storage of arbitrary records.

## Quantum-Inspired Mechanics

The "quantum" part of qDHT is a propagation model, not quantum hardware.

In the simulation layer, information spreads across a graph using amplitude-like weights instead of a simple flood or hop-count walk. That gives the model a few useful behaviors:

- nearby nodes receive stronger signal than distant nodes
- unpopular or low-reputation paths are damped
- a node can keep a small exploration floor so new paths are still tried
- propagation can be tuned for thresholded spread instead of all-or-nothing broadcast

In practical terms, this is a way to model selective diffusion across a network graph. It is inspired by wave behavior, but it runs as ordinary deterministic software.

The same idea shows up in the simulator and the propagator, not as a claim that qDHT itself is physically quantum.

It is organized around a few bounded layers:

- `src/core` for protocol, identity, graph, discovery, and content primitives
- `src/node` for the live node runtime, CLI, transports, and persistence
- `web` for the browser dashboard served by the live node
- `src/sim` for the simulation harness and comparison scenarios
- `src/bench` for qDHT vs baseline benchmark runs
- `examples` for runnable demos
- optional local-network peer discovery via signed service-record gossip

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
- `npm run node:start -- --web-port 3000` start the daemon with the web dashboard enabled
- `npm run node:start -- --local-discovery` start the daemon with local-network peer discovery enabled
- `npm run web:start` start the daemon with the web dashboard on port 3000
- `npm run example:hello` run the simplest publish/get demo
- `npm run example:reachability` run the DNS-less identity-to-route demo
- `npm run example:spam` run the spam-filter comparison demo
- `npm run bench:dht` compare qDHT against the libp2p Kad-DHT baseline
- `npm run stress:quic` run the QUIC live-node stress harness

## Deploying to a Remote Server

Build the compiled output, then run the deploy script (requires `node`, `npm`, `git`, `rsync`, `systemctl`):

```bash
# First install
scripts/deploy.sh install --domain qdht.example.com

# Pull latest and restart
scripts/deploy.sh update

# Smoke-test a running node
scripts/deploy.sh test
```

To deploy a bootstrap node (rendezvous node for peer discovery, no content ops):

```bash
scripts/deploy.sh install --domain bootstrap.example.com --bootstrap
```

The script auto-detects Caddy or nginx for reverse proxy setup. Use `--proxy none` to skip.

Environment overrides: `QDHT_DOMAIN`, `QDHT_PORT`, `QDHT_PROXY`, `QDHT_BOOTSTRAP`, `QDHT_DRY_RUN`.

To build compiled JS locally without deploying:

```bash
npm run build:dist   # emits to dist/
```


## Documentation Map

- [`src/core/README.md`](src/core/README.md)
- [`src/node/README.md`](src/node/README.md)
- [`src/sim/README.md`](src/sim/README.md)
- [`src/bench/README.md`](src/bench/README.md)
- [`bin/README.md`](bin/README.md)
- [`examples/README.md`](examples/README.md)
- [`web/README.md`](web/README.md)

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
- a browser dashboard served from the live node when `webPort` is configured
- a shared `qdht.sqlite` file with normalized tables for kinds, identities, events, tags, route references, and content indexes
- content-provider and reachability examples
- benchmark and stress harnesses

## Discovery Routing

Identity-to-route resolution lives in `src/core/discovery/reachability.ts`. When a node wants to dial a peer by pubkey or Nostr identity reference, it:

1. Normalises the identity reference (npub, hex pubkey, or `_@domain` NIP-05 style) to a canonical form.
2. Looks up stored route announcements (kind `30181`) in the local event log.
3. Scores candidates by confidence, sequence number, and observed NAT type.
4. Returns a `ResolvedRoute` with `bestEndpoint`, optional `fallback`, and a `nat.typeEstimate` field.

Peers also emit observed-address events so each node learns its own externally-visible address without a STUN server. The reachability layer uses those reflections to set `typeEstimate` to one of `open`, `cone`, `symmetric`, or `unknown`.

Regular nodes also ingest `30181` service records and may auto-connect to the advertised endpoint when the peer discovery policy allows it. Bootstrap nodes still cache and fan out service records, but they do not auto-dial peers.

If `localDiscovery` is enabled, nodes also gossip those signed service records over a local UDP discovery channel so nearby peers can find each other without manual bootstrap peers.

## Graph Computation Layer

The quantum walk runs in `src/core/graph/`. Three files cooperate:

- `topology.ts` — builds the adjacency structure from connected peers and their reputation scores.
- `laplacian.ts` — computes the bare graph Laplacian `L = D - A` where `D` is the degree matrix and `A` is the weighted adjacency matrix.
- `graph-state.ts` — applies the continuous-time quantum walk (CTQW) operator `exp(-iLΔt)` to an initial amplitude vector, then squares amplitudes to get propagation probabilities: `prob(i) = |<i| exp(-iLΔt) |source>|²`.

The propagator (`src/core/propagation/propagator.ts`) wraps graph-state and adds:

- reputation damping: `effective_prob = quantum_prob × reputation_factor` where `reputation_factor = exp(-2γ|rep|t)`
- a configurable exploration floor so low-probability paths are still sampled occasionally
- top-k target selection from the resulting probability distribution

This runs as ordinary floating-point matrix math. There is no quantum hardware involved.

## Storage Layer

All persistence goes into a single SQLite file (`qdht.sqlite`) under `dataDir`. Two modules manage it:

- `src/core/storage/sqlite-node-storage.ts` — the raw SQLite adapter. Tables include:
  - `kinds` — catalog of known Nostr/qDHT event kinds
  - `identities` — deduplicated pubkeys
  - `events` — signed event headers linked to identities and kinds
  - `tag_keys` — deduplicated Nostr tag names
  - `event_tags` — flattened tag values linked to tag keys
  - `event_identity_refs` — secondary identity references for route, request, and observed-address events
  - `content_index` — content metadata by `qkey` and `hash`
  - `content_piece_hashes` — one row per piece hash for a stored content item
- `src/core/storage/content-repository.ts` — content index on top of the event store. Tracks content locations by `qkey` and `hash`, piece manifests, and replica records. Returns `ContentLocation` objects with piece counts, piece size, and optional source URL.

The event store is append-only for Nostr events. Route and reachability records are stored as signed events and resolved through the normalized event tables. Service records are also used for peer discovery: when a regular node receives a valid `30181` record and the peer discovery policy approves it, the node will auto-connect to that advertised endpoint.

## Examples

All runnable demos are in `examples/`. See [`examples/README.md`](examples/README.md) for full details.

| File | Description | npm script |
|---|---|---|
| `hello-publish-get.ts` | Put a small payload on one node and read it back locally | `npm run example:hello` |
| `peer-gossip-demo.ts` | Start two nodes and observe peer discovery | `npm run example:gossip` |
| `sqlite-persistence-demo.ts` | Publish, restart the node, confirm the event store survives | `npm run example:sqlite` |
| `reachability-reflection-demo.ts` | Peer-observed address reflection, dialback, and relay fallback without DNS | `npm run example:reachability` |
| `churn-recovery-demo.ts` | Announcement delivery under simulated churn and recovery | `npm run example:churn` |
| `spam-filter-demo.ts` | Reputation suppression keeping legitimate traffic moving | `npm run example:spam` |

## Transport Fallback

The live node tries transports in preference order:

1. **QUIC** (`quic-adapter.ts`) — low-latency direct UDP, used when both peers are `open` or `cone` NAT.
2. **WebSocket** (`peer-manager.ts`) — direct TCP connection, used when QUIC is unavailable or the peer is behind symmetric NAT.
3. **Relay** (`relay-adapter.ts`) — routes events through a Nostr relay, used as the fallback of last resort when direct dial fails.

Transport selection happens in `qdht-node.ts`. All three can coexist; each implements the `Transport` interface in `src/node/transport.ts`. Relay transport adds latency but requires no open ports on either side.

## Recommended Reading Order

1. [`src/core/README.md`](src/core/README.md)
2. [`src/node/README.md`](src/node/README.md)
3. [`examples/README.md`](examples/README.md)
4. [`src/sim/README.md`](src/sim/README.md)
5. [`src/bench/README.md`](src/bench/README.md)
