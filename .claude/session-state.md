# Session State: NIP-1984 Internal Reporting

**Task**: Add NIP-1984 reporting to qDHT (propagate through peer network, not Nostr relays)

## Design

- **Kind 1984**: NIP-1984 report events
- **Propagation**: Through qDHT peer graph (like announcements/deltas)
- **Triggers**: Same bad-actor detection (bad signatures, bad hashes, spam)
- **Format**: Standard NIP-1984 with tags for reason, content hash, etc.
- **No relay requirement**: Purely peer-to-peer via sync-manager broadcast

## Implementation

### 1. Add kind 1984 to kinds.ts
```typescript
export const QDHT_KIND = {
  // ... existing
  REPORT: 1984,  // NIP-1984 reporting
}
```

### 2. Create report builder in protocol/
New file: `src/core/protocol/report.ts`
```typescript
export interface Report {
  kind: 1984
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export function buildReport(opts: {
  pubkey: string
  reportedPubkey: string
  reason: 'spam' | 'invalid_content' | 'bad_hash'
  content?: string  // optional details
}): Report {
  return {
    kind: 1984,
    pubkey: opts.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', opts.reportedPubkey],
      ['reason', opts.reason],
    ],
    content: opts.content ?? '',
    sig: '',
  }
}
```

### 3. Update sync-manager
- Import `buildReport`
- When detecting bad signature: create and broadcast report with reason='invalid_content'
- When detecting bad hash: create and broadcast report with reason='bad_hash'
- Handle incoming kind 1984 reports in message router
- Include reports in delta responses (like reputation deltas)
- Store reports in eventLog

### 4. Wire into existing penalty code
Replace/augment the reputation delta broadcasts with:
1. Create kind 1984 report event
2. Broadcast it like announcements (propagates through peer graph)
3. Still send reputation delta for local scoring

## NIP-1984 Reference
https://github.com/nostr-protocol/nips/blob/master/84.md
- `p` tag: pubkey being reported
- `e` tag: event id being reported (optional)
- `reason` tag: spam | abuse | illegal | profanity | etc
- content: explanation

For qDHT:
- reason: 'spam' | 'invalid_content' | 'bad_hash'
- tags: [['p', reportedPubkey], ['reason', reason]]

## Testing
- Unit test: buildReport creates valid events
- Integration: nodes exchange reports and see them in eventLog
- Spam scenario: verify reports are generated and propagated
