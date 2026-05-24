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
