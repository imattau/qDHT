# `src/core/discovery`

Identity discovery and route resolution.

## Files

- `reachability.ts` builds and resolves route announcements
- `reachability.test.ts` covers identity normalization and route lookup

## What it handles

- Nostr identity references such as raw pubkeys, `npub`, `nprofile`, and `nostr://`
- observed address reflection
- NAT classification heuristics
- route announcements with fallback endpoints
- peer-target resolution for live dialing

## How it fits

This layer is the DNS-like lookup path for qDHT. It turns an identity reference into a usable set of transport endpoints, preferably with a direct route and a relay fallback.
