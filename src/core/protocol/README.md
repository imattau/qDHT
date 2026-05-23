# `src/core/protocol`

Protocol-level event builders and validators.

## Files

- `announcement.ts` builds content announcements
- `delta.ts` builds delta request and response events
- `piece-manifest.ts` describes piece layouts for large content
- `replica-record.ts` records replica providers
- `reputation.ts` tracks reputation changes
- `request.ts` defines metadata-only search request and response events

## Purpose

This folder defines the wire-level qDHT vocabulary. These builders are used by both the live node and the simulation code.

## Rule of thumb

- announcements say what exists
- requests ask for metadata or routes
- responses return pointers and references
- raw content stays outside the DHT
