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
