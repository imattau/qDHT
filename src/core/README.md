# `src/core`

Core protocol and domain logic for qDHT.

This folder contains the pieces that are shared by the simulation layer and the live node.

## Submodules

- [`content`](content/README.md) for providers, piece fetching, and replica tracking
- [`discovery`](discovery/README.md) for identity-to-route resolution and observed address reflection
- [`graph`](graph/README.md) for graph state, topology generation, and Laplacian helpers
- [`identity`](identity/README.md) for key generation, signing, and encryption helpers
- [`nostr`](nostr/README.md) for Nostr event shapes, kinds, filters, tags, and SQLite persistence
- [`propagation`](propagation/README.md) for spread/routing heuristics
- [`protocol`](protocol/README.md) for announcement, delta, replica, request, and reputation types
- [`storage`](storage/README.md) for backend-neutral content/event repository contracts
- [`sqlite`](sqlite/README.md) for the shared low-level SQLite connection helper

## Role in the system

`src/core` is intentionally runtime-agnostic. It defines the reusable parts of the protocol and data model without depending on the live node process or the simulation harness.
