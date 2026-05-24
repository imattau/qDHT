# `bin`

This folder contains command-line entrypoints.

## `qdht-node.ts`

The main live-node CLI. It can:

- start the daemon
- store content and announce it
- fetch content
- list peers
- list replicas
- search identity routes and metadata
- serve the browser dashboard when `--web-port <port>` is set on `start`

## Usage

Run through `tsx`:

```bash
tsx bin/qdht-node.ts --help
```

The root `package.json` exposes the common entrypoints as npm scripts.

## Commands

### `start`

Start the qDHT node daemon. Runs until interrupted (SIGINT).

```bash
tsx bin/qdht-node.ts start [options]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--config <path>` | string | `~/.qdht/config.json` | Config file path. Created with defaults if it does not exist. |
| `--port <port>` | number | from config | WebSocket listen port. If already in use, increments to the next free port. |
| `--web-port <port>` | number | from config | HTTP port for the browser dashboard and JSON API. Set to `0` to pick any free port. |
| `--data-dir <dir>` | string | `~/.qdht/data` | Directory for `qdht.sqlite` and the Unix socket `qdht.sock`. |
| `--nsec <nsec>` | string | — | Run this instance with the supplied Nostr private key for the current session. |
| `--random-nsec` | flag | off | Generate a random Nostr private key for this session and print the resulting `nsec` on startup. |
| `--local-discovery` | flag | off | Enable UDP multicast peer discovery on the local network. |
| `--local-discovery-port <port>` | number | `45555` | UDP port used for local discovery broadcasts and listeners. |

On startup the node prints its pubkey, bound port, data directory, and web URL (if web is enabled).
When `--random-nsec` is used, the startup output also prints the generated `nsec`.
When `--local-discovery` is enabled, the node advertises and listens for signed `30181` service records over UDP multicast so nearby peers can auto-connect without manual bootstrap peers.

### `put <file>`

Store a file on disk, index it in the local content store, and publish an announcement to connected peers.

```bash
tsx bin/qdht-node.ts put <file> [options]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--config <path>` | string | `~/.qdht/config.json` | Config file path. |
| `--ttl <seconds>` | number | `86400` | Time-to-live for the announcement in seconds. |
| `--linger <ms>` | number | `0` | Keep the process alive after announcing (gives peers time to receive and replicate). |
| `--data-dir <dir>` | string | from config | Override data directory. |

Prints the `qkey` for the stored content on success.

### `get <key>`

Retrieve content by `qkey`. Connects to a running node via Unix socket RPC, then fetches missing pieces from providers or replicas.

```bash
tsx bin/qdht-node.ts get <key> [options]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--config <path>` | string | `~/.qdht/config.json` | Config file path. |
| `--out <file>` | string | — | Write content to this file. If omitted, writes to stdout. |
| `--timeout <ms>` | number | `30000` | Fetch timeout in milliseconds. |

Progress is printed to stderr when `--out` is set.

### `peers`

List peers currently connected to a running daemon. Requires a running `start` daemon.

```bash
tsx bin/qdht-node.ts peers [options]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--config <path>` | string | `~/.qdht/config.json` | Config file path (used to locate `qdht.sock`). |

Output columns: `PUBKEY` (first 10 chars), `URL`, `LATENCY`, `CONNECTED_AT`.

### `replicas <key>`

List known replica providers for a content key from a running daemon.

```bash
tsx bin/qdht-node.ts replicas <key> [options]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--config <path>` | string | `~/.qdht/config.json` | Config file path. |

Output columns: `PUBKEY`, `LAST_SEEN`, `PIECES`, `TOTAL`.

### `search <query>`

Search identity routes or announcement metadata on a running daemon.

```bash
tsx bin/qdht-node.ts search <query> [options]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--config <path>` | string | `~/.qdht/config.json` | Config file path. |
| `--type <type>` | `identity\|content\|route\|replica` | `content` | Search type. `identity` resolves a pubkey or Nostr reference to a route. |
| `--timeout <ms>` | number | `2000` | How long to wait for remote responses. |
| `--limit <n>` | number | `25` | Maximum number of matches. |
| `--publisher <pubkey>` | string | — | Filter by publisher pubkey. |
| `--qkey <qkey>` | string | — | Filter by qkey. |
| `--hash <hash>` | string | — | Filter by content hash. |
| `--name <name>` | string | — | Filter by content name. |
| `--mime <mime>` | string | — | Filter by MIME type. |
| `--tag <tag>` | string | — | Filter by tag. |

For `--type identity`, prints the resolved route including transport, address, port, confidence, NAT estimate, and sequence number.

For other types, prints matching announcements, replicas, and routes grouped by category.

## RPC Socket

`peers`, `replicas`, and `search` communicate with a running daemon via a Unix domain socket at `<dataDir>/qdht.sock`. The protocol is newline-delimited JSON: one request object, one response object. RPC calls time out after 30 seconds.
