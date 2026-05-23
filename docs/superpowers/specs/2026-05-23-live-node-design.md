# Phase 3: Live Node Design

**Date**: 2026-05-23
**Phase**: 3 — Live Node (`qdht-node`)

---

## Purpose

Build the first runnable qDHT node as a CLI application. Uses src/core/ from Phases 1+2. Proves the protocol works over real WebSocket connections between processes.

---

## Decisions

- **CLI**: commander.js
- **WebSocket**: `ws` library (server + client)
- **Config**: JSON file (~/.qdht/config.json) + CLI flag overrides
- **Peer discovery**: Seed peers in config (MVP); kind-30181 relay query planned for later
- **Architecture**: Service-oriented — PeerManager + SyncManager + ContentStore, orchestrated by QDHTNode
- **RPC**: Unix socket at {dataDir}/qdht.sock, newline-delimited JSON

---

## Package Structure

```
src/node/
  qdht-node.ts        # orchestrator: wires PeerManager + SyncManager + ContentStore
  peer-manager.ts     # ws connections (inbound + outbound), reconnect, ping/pong, message routing
  sync-manager.ts     # announcement/replica propagation, delta catch-up, neighbour state
  content-store.ts    # local filesystem piece storage, implements ContentProvider
  config.ts           # load/validate ~/.qdht/config.json + CLI flag overrides

bin/
  qdht-node.ts        # CLI entry: commander.js (start, put, get, peers, replicas)
```

Config shape:
```json
{
  "identity": { "privkey": "<hex>" },
  "peers": ["ws://host:port"],
  "port": 7777,
  "dataDir": "~/.qdht/data"
}
```

---

## PeerManager

Manages all WebSocket connections (inbound + outbound).

- WS server on config.port
- Outbound connections to config.peers[] on startup
- Handshake: exchange pubkeys on connect
- Exponential backoff reconnect for outbound: 1s → 2s → 4s → ... → 60s, reset after 30s stable
- Keepalive: ping every 30s, disconnect after 90s silence
- Interface: `connect(url)`, `broadcast(msg, exclude?)`, `send(peerId, msg)`, `peers() → PeerInfo[]`, `onMessage(handler)`

---

## SyncManager

Central message dispatcher and sync coordinator.

Dispatches by kind:
- 10800 (announcement): verifyEvent → addNote to Propagator → recordInbound on NeighbourStateMap → broadcast (exclude sender)
- 10801 (replica): update ReplicaStore → update neighbour state
- 20800 (delta request): respond with events since requested timestamp
- 20801 (delta response): merge events into local state (no re-broadcast)

On new peer connect: send DeltaRequest with since=lastSeen for that peer (0 if unknown).

`publishAnnouncement(opts)`: build event → signAnnouncement → broadcast → addNote locally.

---

## ContentStore

Local filesystem piece storage. No external dependencies (Node crypto + fs/promises).

Filesystem layout:
```
{dataDir}/
  index.json                  # qkey → {hash, totalPieces, pieceSize, name, createdAt}
  {hash}/
    {pieceIndex}.bin          # raw piece bytes
```

Interface (implements ContentProvider):
- `put(data, meta)`: sha256 hash, split to pieces, write files, update index, return ContentLocation
- `getPiece(hash, index)`: read file, verify sha256
- `hasPiece(hash, index)`: stat file

---

## CLI Commands

Entry: `bin/qdht-node.ts` (commander.js)

### `qdht-node start`
Load/init config → generate identity if missing → start WS server → connect seeds → open Unix socket RPC → log pubkey+port → run until SIGINT

### `qdht-node put <file>`
In-process (no daemon needed). Read file → ContentStore.put → SyncManager.publishAnnouncement → print qkey to stdout.

### `qdht-node get <key> [--out <file>]`
Connect to Unix socket → {cmd:"get",key} → reassemble pieces → write to --out or stdout. 30s timeout.

### `qdht-node peers`
Connect to Unix socket → {cmd:"peers"} → print aligned table (pubkey, url, latency, connectedAt).

### `qdht-node replicas <key>`
Connect to Unix socket → {cmd:"replicas",key} → print provider table from NeighbourStateMap.

### RPC Protocol
Newline-delimited JSON over Unix socket at {dataDir}/qdht.sock.
| Request | Response |
|---|---|
| `{cmd:"peers"}` | `{peers: PeerInfo[]}` |
| `{cmd:"replicas", key}` | `{replicas: ReplicaInfo[]}` |
| `{cmd:"get", key}` | `{pieces:[{index, data:base64}]}` or `{error}` |

If socket absent: `Error: no running qdht-node found. Run 'qdht-node start' first.`

---

## Types

```typescript
interface PeerInfo { pubkey: string; url: string; latencyMs: number | null; connectedAt: string }
interface ReplicaInfo { pubkey: string; lastSeen: string; pieceCount: number; totalPieces: number }
```

---

## Dependencies Added

- `ws` + `@types/ws` — WebSocket server and client
- `commander` — CLI framework
