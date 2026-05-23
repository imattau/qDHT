# qDHT Examples

Run these with `tsx` or the matching npm scripts.

## Live node demos

- `hello-publish-get.ts`
  - Put a small payload on one node and read it back locally.
- `peer-gossip-demo.ts`
  - Start two nodes and show peer discovery.
- `sqlite-persistence-demo.ts`
  - Publish on one node, restart it, and confirm the event store survives.
- `reachability-reflection-demo.ts`
  - Show peer-observed address reflection, dialback confirmation, and relay fallback without DNS.

## Simulation demos

- `churn-recovery-demo.ts`
  - Show announcement delivery under churn and recovery.
- `spam-filter-demo.ts`
  - Show that reputation suppression keeps legitimate traffic moving.

## Run

```bash
npm run example:hello
npm run example:gossip
npm run example:sqlite
npm run example:reachability
npm run example:churn
npm run example:spam
```
