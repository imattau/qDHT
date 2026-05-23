# Session State: Spam Reporting System Implementation

**Generated**: 2026-05-23 (context: 57%)  
**Task**: Wire up automatic spam/reputation reporting in qDHT live node

## ✅ Completed

Added `buildReputationDelta()` function to `src/core/protocol/delta.ts`:
- Builds kind 10802 events with target pubkey and delta score
- Includes `ReputationDelta` and `ReputationDeltaContent` interfaces

## 📋 Remaining Tasks

### 1. sync-manager.ts - Penalize bad signatures
**File**: `src/node/sync-manager.ts`, method `handleAnnouncement()` (~line 139)
- When `verifyEvent()` fails (line 143), before returning add:
  ```typescript
  this.reputationMap.adjust(event.pubkey, -0.1)
  this.broadcastReputationDelta(event.pubkey, -0.1)
  ```
- Add helper method that creates and broadcasts reputation delta event

### 2. piece-fetcher-service.ts - Penalize bad hashes  
**File**: `src/node/piece-fetcher-service.ts`, method `fetchContent()` (~line 83)
- When hash mismatch (line 83-85), penalize providers:
  ```typescript
  for (const task of selected) {
    this.reputationMap.adjust(task.nodeId, -0.2)
  }
  ```
- Also on fetch errors (line 129): penalize nodeId by -0.05

### 3. sync-manager.ts - Merge received reputation deltas
**File**: `src/node/sync-manager.ts`, method `handleDeltaResponse()` (~line 195)
- Parse reputationDeltas array from delta response payload
- For each delta, merge into local map via `reputationMap.merge()`

### 4. sync-manager.ts - Include deltas in delta responses
**File**: `src/node/sync-manager.ts`, method `handleDeltaRequest()` (~line 165)
- Collect recent reputation delta events (kind 10802) from eventLog
- Serialize and include in `reputationDeltas` array of response (line 189)

## Imports Needed
```typescript
import { buildReputationDelta } from '../core/protocol/delta.js'
```

## Penalty Schedule
- Bad signature: -0.1
- Bad content hash: -0.2
- Fetch error: -0.05

## Test Commands
```bash
npm run test           # all tests
npm run sim:spam      # spam scenario
```
