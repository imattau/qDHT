# `src/core/sqlite`

Shared SQLite connection helpers.

## Files

- `sqlite-connection.ts` wraps the runtime `node:sqlite` binding

## Purpose

This layer centralizes the low-level database opening, pragmas, statement preparation, and closing logic used by the content index and Nostr event stores.

The repository contracts themselves live in [`../storage`](../storage/README.md), which keeps the higher-level node code backend-neutral while SQLite remains one implementation.
