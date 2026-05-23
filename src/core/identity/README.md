# `src/core/identity`

Key generation, signing, and encryption helpers.

## Files

- `keys.ts` generates and converts key pairs
- `signing.ts` signs and verifies Nostr-shaped events
- `encryption.ts` wraps private payload encryption helpers

## Purpose

This layer keeps the crypto-facing pieces in one place so protocol and node code can depend on a consistent key and event API.
