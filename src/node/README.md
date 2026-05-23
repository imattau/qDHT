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

The live node stores its SQLite-backed index and event history in a single `qdht.sqlite` file under `dataDir`.

## CLI

The CLI entrypoint is [`bin/qdht-node.ts`](../../bin/qdht-node.ts).

Supported commands:

- `start`
- `put`
- `get`
- `peers`
- `replicas`
- `search`

## Runtime model

The node composes:

- local content storage
- a persisted Nostr event log
- one or more transports
- route discovery for identity-based dialing
- metadata search via request announcements

## Notes

The node is built to be additive. WebSocket, relay, and QUIC transports can coexist.
