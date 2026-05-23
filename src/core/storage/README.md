# `src/core/storage`

Backend-neutral storage contracts for qDHT.

## Files

- `content-repository.ts` defines the content index repository contract and shared content metadata types
- `event-repository.ts` defines the Nostr event repository contract and stored event type
- `node-storage.ts` combines the content and event repositories into a single node-owned storage boundary
- `memory-node-storage.ts` provides a simple in-memory implementation for tests and backend validation
- `sqlite-node-storage.ts` provides the current SQLite-backed implementation of that boundary

## Purpose

This layer separates the qDHT runtime from a specific persistence backend. The live node can depend on `NodeStorage` and the repository interfaces, while SQLite remains just one concrete implementation.

The current SQLite implementation keeps the data relational:
- kinds in `kinds`
- identities in `identities`
- content metadata in `content_index`
- content piece hashes in `content_piece_hashes`
- Nostr event headers in `events`
- Nostr tags in `event_tags`
- Nostr tag names in `tag_keys`
- Nostr identity references in `event_identity_refs`
