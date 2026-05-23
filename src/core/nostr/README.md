# `src/core/nostr`

Nostr event shapes, tags, filters, kinds, and persistence helpers.

## Files

- `event.ts` defines the base event types
- `kinds.ts` centralizes the qDHT kind registry
- `tags.ts` provides tag helpers
- `filter.ts` matches events against query filters
- `relay-adapter.ts` bridges qDHT events to relay transport
- `sqlite-store.ts` persists Nostr event history in SQLite

## Purpose

This folder is the event-layer substrate for qDHT. It keeps event encoding, filtering, and storage separate from higher-level request, route, and content logic.
