# `src/node`

The live qDHT node runtime.

## Files

- `qdht-node.ts` is the main node class and daemon orchestration layer
- `config.ts` loads and validates runtime config
- `peer-manager.ts` manages WebSocket peers
- `relay-adapter.ts` connects to Nostr relays
- `quic-adapter.ts` manages QUIC transport peers
- `sync-manager.ts` handles event propagation, requests, responses, and persistence
- `content-store.ts` stores local content on disk
- `piece-fetcher-service.ts` fetches content pieces from providers
- `transport.ts` defines the transport interface
- `quic-stress.ts` runs a live QUIC stress harness
- `web-server.ts` serves the browser dashboard and JSON API when `webPort` is configured

The live node stores its SQLite-backed index and event history in a single `qdht.sqlite` file under `dataDir`.
When enabled, the web frontend is served from the same node process on the configured `webPort`.
If either the node listen port or the web port is already in use, qDHT now increments to the next free port and reports the actual bound port at startup.
Regular nodes also auto-connect to advertised `30181` service records when the peer discovery policy approves the endpoint. Bootstrap nodes intentionally skip that dialing step so they remain rendezvous-only peers.

## CLI

The CLI entrypoint is [`bin/qdht-node.ts`](../../bin/qdht-node.ts).

Supported commands:

- `start`
- `put`
- `get`
- `peers`
- `replicas`
- `search`
- browser dashboard served from `web/`

## Runtime model

The node composes:

- local content storage
- a persisted Nostr event log
- one or more transports
- route discovery for identity-based dialing
- metadata search via request announcements
- browser control panel for status, search, publishing, and fetch operations

## Notes

The node is built to be additive. WebSocket, relay, and QUIC transports can coexist.
Bootstrap mode is a special case: it caches and fans out service records, but it does not initiate peer dials from them.

## Sync Manager: Event Routing Flow

`sync-manager.ts` is the central message dispatcher. Every inbound event from any transport is passed to `handleMessage(msg, fromPeerId)`, which switches on `event.kind`:

| Kind | Handler | What it does |
|---|---|---|
| `10800` | `handleAnnouncement` | Validates signature, records in event store, updates neighbour-state, re-propagates via propagator |
| `10801` | `handleReplica` | Validates and stores replica record, updates content repository |
| `10804` | `handleRequestAnnouncement` | Parses search request, builds local response from event store, broadcasts response |
| `10805` | `handleRequestResponse` | Stores response keyed by request ID, unblocks pending `searchRequest` callers |
| `REACHABILITY_KIND.OBSERVED_ADDRESS` | `handleObservedAddress` | Stores peer-reflected address for NAT type estimation |
| `REACHABILITY_KIND.ROUTE_ANNOUNCEMENT` | `handleRouteAnnouncement` | Upserts route record in reachability store |
| `20800` | `handleDeltaRequest` | Reads events since `since` timestamp, sends `20801` delta response |
| `20801` | `handleDeltaResponse` | Replays missed events from delta response into local state |

Outbound flows:

- `publishAnnouncement` — builds kind `10800`, signs it, records it, broadcasts to all connected peers via propagator
- `searchRequest` — builds kind `10804`, broadcasts, then waits up to `timeoutMs` for a `10805` response
- `sendDeltaRequest` — sends kind `20800` on connect to catch up missed events

## Peer Lifecycle

`peer-manager.ts` manages WebSocket connections. The lifecycle for each peer:

1. **Connect** — outbound peers use `ReconnectingWebSocket` with exponential backoff (1 s to 60 s). Inbound peers are accepted by the `WebSocketServer`.
2. **Handshake** — on connection, both sides send a `{ type: "handshake", pubkey, url }` message. The peer is registered in `peerMap` keyed by pubkey once the handshake is received.
3. **Ping / Pong** — a `setInterval` fires every 30 seconds. Each peer receives a WebSocket ping. If no pong arrives within 90 seconds the connection is destroyed and the peer is removed.
4. **Delta request** — `SyncManager.onPeerConnected` fires after handshake and immediately sends a `20800` delta request using the last-seen timestamp for that peer (or `0` for new peers).
5. **Message dispatch** — all inbound messages are JSON-parsed and forwarded to registered `onMessage` handlers (the sync manager).
6. **Disconnect** — on close or error, `peerDisconnectedHandlers` fire, `peerLastSeen` is cleared in the sync manager, and outbound peers schedule a reconnect.

Constants: ping interval 30 s, pong timeout 90 s, reconnect min 1 s, reconnect max 60 s.

## Web Server: API Endpoints

`web-server.ts` exposes a JSON API and serves the static dashboard from `web/`. All responses include `access-control-allow-origin: *` and `cache-control: no-store`.

| Method | Path | Query / Body params | Response |
|---|---|---|---|
| `GET` | `/api/status` | — | `{ pubkey, port, dataDir, peerCount, peers[], webPort }` |
| `GET` | `/api/peers` | — | `{ peers: PeerInfo[] }` where `PeerInfo = { pubkey, url, latencyMs, connectedAt }` |
| `GET` | `/api/replicas` | `key` (required) | `{ replicas: ReplicaInfo[] }` |
| `GET` | `/api/search` | `query`, `type` (`identity\|content\|route\|replica`), `timeoutMs`, `limit`, `publisher`, `qkey`, `hash`, `name`, `mime`, `tag` | For `identity`: `{ route: ResolvedRoute \| null }`. For others: `{ response: QDHTRequestResponsePayload \| null }` |
| `GET` | `/api/content` | `key` (required) | `{ found, key, size, mime, name, contentBase64, text, announcement }` or `404 { error }` |
| `POST` | `/api/put` | JSON body: `{ dataBase64, name?, ttl?, mime? }` | `{ location: ContentLocation }` |
| `OPTIONS` | `*` | — | 204 with CORS preflight headers |
| `GET` | `/*` | — | Static file from `web/` directory |

Error responses always have the shape `{ error: string }` with an appropriate HTTP status code (400, 403, 404, or 500).

The server binds to `127.0.0.1` only. If the requested port is taken, `get-port` selects the next available port above it.

## Content Store and Piece Fetcher

`content-store.ts` manages on-disk storage for raw content bytes. Files are stored under `dataDir` and indexed in `qdht.sqlite` via the content repository. Each stored item has a `qkey` (derived from hash), content hash, piece count, and piece size.

`piece-fetcher-service.ts` fetches content from remote providers or replicas when local storage misses:

1. Looks up the piece manifest from the content repository (piece hashes, sizes, provider list).
2. Scores providers by reputation and latency, preferring nearby high-reputation peers.
3. Requests rare pieces first (pieces with the fewest known providers).
4. Verifies each piece hash on receipt; drops and re-requests on mismatch.
5. Emits `progress` events (`{ fetched, total }`) as pieces arrive.
6. Reassembles pieces only after all hashes pass; aborts if the root hash does not match.
