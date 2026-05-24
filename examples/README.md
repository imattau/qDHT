# qDHT Examples

Run these with `tsx` or the matching npm scripts.

## Live node demos

| File | Description | npm script |
|---|---|---|
| `hello-publish-get.ts` | Put a small payload on one node and read it back locally | `npm run example:hello` |
| `peer-gossip-demo.ts` | Start two nodes, connect them, and observe peer discovery and announcement propagation | `npm run example:gossip` |
| `sqlite-persistence-demo.ts` | Publish on one node, stop it, restart it, and confirm the event store and content index survive the restart | `npm run example:sqlite` |
| `reachability-reflection-demo.ts` | Demonstrate peer-observed address reflection, dialback confirmation, and relay fallback without DNS or STUN | `npm run example:reachability` |

## Simulation demos

| File | Description | npm script |
|---|---|---|
| `churn-recovery-demo.ts` | Run a simulated network with nodes joining and leaving, measure announcement delivery rate during churn and after recovery | `npm run example:churn` |
| `spam-filter-demo.ts` | Inject a spam publisher into a simulation and confirm that reputation damping suppresses spam traffic while legitimate announcements still reach interested nodes | `npm run example:spam` |

## Shared utilities

`_shared.ts` contains helper functions used by multiple demos: node factory, wait-for-peer helpers, and log formatting.

## Run

```bash
npm run example:hello
npm run example:gossip
npm run example:sqlite
npm run example:reachability
npm run example:churn
npm run example:spam
```

Or run a single file directly:

```bash
tsx examples/hello-publish-get.ts
```
