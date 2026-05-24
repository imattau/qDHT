# Web Frontend

This folder contains the browser UI for a running qDHT node.

The UI is served by the node itself when `webPort` is configured in the node config or passed via `qdht-node start --web-port <port>`.
If that port is taken, the node automatically increments until it finds a free one and prints the final URL on startup.

## Features

- live node status
- peer list
- content publish form
- identity and metadata search
- content fetch by qkey

## Visual Direction

The UI uses a data-brutalist layout:

- dark technical palette
- IBM Plex Sans + IBM Plex Mono
- dense cards and visible borders
- minimal motion and strong contrast

## Usage

Start the node with a web port:

```bash
tsx bin/qdht-node.ts start --web-port 3000
```

Then open the printed `http://127.0.0.1:<port>` URL.

## Dashboard Sections

| Section | What it shows |
|---|---|
| Status | Node pubkey, listen port, data directory, peer count, web port |
| Peers | Live list of connected peers with pubkey, URL, latency, and connected-at timestamp |
| Publish | Form to upload content: accepts base64 data, optional name, MIME type, and TTL |
| Search | Query box with type selector (`identity`, `content`, `route`, `replica`) and filter fields for publisher, qkey, hash, name, MIME, and tag |
| Fetch | Retrieve content by qkey; displays text inline if the content is printable, otherwise offers base64 |

## API Endpoint Reference

The dashboard talks to the same HTTP server that serves the static files. All API routes are under `/api/`. All responses are JSON with `content-type: application/json; charset=utf-8`.

### `GET /api/status`

Returns current node state.

```json
{
  "pubkey": "<hex>",
  "port": 4000,
  "dataDir": "/home/user/.qdht/data",
  "peerCount": 3,
  "peers": [...],
  "webPort": 3000
}
```

### `GET /api/peers`

Returns all currently connected peers.

```json
{
  "peers": [
    {
      "pubkey": "<hex>",
      "url": "ws://1.2.3.4:4000",
      "latencyMs": 42,
      "connectedAt": "2026-05-24T10:00:00.000Z"
    }
  ]
}
```

`latencyMs` is `null` if no ping-pong round trip has completed yet.

### `GET /api/replicas?key=<qkey>`

Returns known replica providers for the given content key.

```json
{
  "replicas": [
    {
      "pubkey": "<hex>",
      "lastSeen": "2026-05-24T10:00:00.000Z",
      "pieceCount": 4,
      "totalPieces": 4
    }
  ]
}
```

Returns `400 { "error": "missing key" }` if `key` is absent.

### `GET /api/search`

Searches announcements, routes, or resolves an identity.

Query parameters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | string | `""` | Search query string |
| `type` | `identity\|content\|route\|replica` | `content` | Search type |
| `timeoutMs` | number | `2000` | Wait time for remote responses |
| `limit` | number | `25` | Maximum result count |
| `publisher` | string | — | Filter by publisher pubkey |
| `qkey` | string | — | Filter by qkey |
| `hash` | string | — | Filter by content hash |
| `name` | string | — | Filter by name |
| `mime` | string | — | Filter by MIME type |
| `tag` | string | — | Filter by tag |

For `type=identity`, response shape:

```json
{
  "route": {
    "identity": "<hex>",
    "reachable": true,
    "bestEndpoint": { "transport": "ws", "address": "1.2.3.4", "port": 4000, "confidence": 0.95 },
    "fallback": { "transport": "relay", "address": "wss://relay.example.com", "confidence": 0.5 },
    "nat": { "typeEstimate": "cone" },
    "sequence": 12,
    "updatedAt": 1716544800000
  }
}
```

`route` is `null` if no route is known. For other types:

```json
{
  "response": {
    "requestType": "content",
    "query": "example",
    "limit": 25,
    "announcements": ["<raw event JSON>", ...],
    "replicas": ["<raw event JSON>", ...],
    "routes": ["<raw event JSON>", ...]
  }
}
```

`response` is `null` if no matches were found within `timeoutMs`.

### `GET /api/content?key=<qkey>`

Returns locally stored content for a qkey.

```json
{
  "found": true,
  "key": "<qkey>",
  "size": 1234,
  "mime": "text/plain",
  "name": "example.txt",
  "contentBase64": "<base64>",
  "text": "hello world",
  "announcement": {
    "hash": "<hex>",
    "totalPieces": 1,
    "pieceSize": 1234,
    "sourceUrl": null,
    "name": "example.txt",
    "mime": "text/plain"
  }
}
```

`text` is `null` if the content does not appear to be valid UTF-8 text (heuristic: less than 85% printable bytes in the first 4096 bytes). Returns `404 { "error": "not found" }` if the key is not in local storage.

### `POST /api/put`

Store and announce content.

Request body (JSON):

```json
{
  "dataBase64": "<base64 encoded bytes>",
  "name": "example.txt",
  "mime": "text/plain",
  "ttl": 86400
}
```

`dataBase64` is required. `name`, `mime`, and `ttl` are optional (`ttl` defaults to `86400`).

Response:

```json
{
  "location": {
    "qkey": "<qkey>",
    "hash": "<hex>",
    "totalPieces": 1,
    "pieceSize": 1234
  }
}
```

Returns `400 { "error": "missing dataBase64" }` if the field is absent or empty.

## Error Response Format

All error responses use the shape:

```json
{ "error": "<human-readable message>" }
```

HTTP status codes used: `400` (bad request / missing parameter), `403` (path traversal attempt on static files), `404` (not found), `500` (server error or missing `index.html`).
