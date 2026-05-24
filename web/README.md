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
