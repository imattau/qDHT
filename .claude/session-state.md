# Session State — Bootstrap Node Design Brainstorm

execution_mode: unattended
auto_continue: false

## Objective
Design a bootstrap node mode for qDHT following the brainstorming skill process. Write a spec doc and commit it.

## Decisions Made So Far
- **Mode**: C — passive peer discovery via `30181` node profile events (+ nodes publish `30181` on connect)
- **NAT reflection**: Yes — bootstrap reflects connecting peer's public IP/port back (STUN-like), reusing existing `OBSERVED_ADDRESS` reachability kind and `req.socket.remoteAddress` in peer-manager.ts:84
- **Persistence**: C — persist only static seed peers from config; dynamic peers in-memory
- **Rendezvous**: Full rendezvous — initial connection point AND helps peers find each other so they can disconnect from bootstrap once connected
- **CLI/config**: NOT YET DECIDED — one question remaining

## Remaining Brainstorm Questions
1. Bootstrap mode: CLI flag (`--bootstrap`), config field (`bootstrap: true`), or both?

## Design to Cover
- `30181` publish on node startup (prerequisite)
- Bootstrap mode flag/config
- Higher connection limits in bootstrap mode
- Skip content ops (no Propagator, ReplicaStore, ReputationMap, ContentProviderRegistry)
- Cache received `30181` events and rebroadcast to new peers on connect
- IP reflection via OBSERVED_ADDRESS on connect

## Key Files
- src/node/qdht-node.ts — main node
- src/node/peer-manager.ts — remoteAddress at line 84
- src/node/config.ts — QDHTConfig interface
- src/node/README.md — documents OBSERVED_ADDRESS

## Spec Output
docs/superpowers/specs/2026-05-24-bootstrap-node-design.md

## Skill Checklist
- [x] Explore project context
- [ ] Ask final clarifying question (CLI vs config)
- [ ] Propose 2-3 approaches
- [ ] Present design sections + get approval
- [ ] Write design doc
- [ ] Spec self-review
- [ ] User reviews spec
- [ ] Invoke writing-plans skill
