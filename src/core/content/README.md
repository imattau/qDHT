# `src/core/content`

Content storage, provider selection, and piece fetching.

## Files

- `provider.ts` defines the provider interface
- `provider-registry.ts` keeps providers ordered and queryable
- `filesystem-provider.ts` serves content from local disk
- `http-provider.ts` fetches content from HTTP(S) locations
- `nip96-provider.ts` fetches content from NIP-96 upload servers
- `piece-fetcher.ts` orchestrates piece downloads and verification
- `replica-store.ts` tracks replica availability in memory

## How it fits

The live node uses this layer to:

- write content locally
- advertise metadata to the network
- fetch content from the nearest usable source
- fall back across providers when one source fails

## Design rule

This folder is about bytes and verified pieces, not global search. Search lives at the announcement/discovery layer.
