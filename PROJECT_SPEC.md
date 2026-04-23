# TornPDA Market Watcher Project Spec

## Project Name

TornPDA Market Watcher

## Goal

Build a personal Torn market watching system that tracks selected items using Weav3r marketplace data, evaluates custom price conditions, and alerts the user through TornPDA when an item is cheap enough to buy or close enough to the target price to deserve attention.

## Core Concept

This is not meant to be a full TornPDA-only script. The main logic belongs in a small backend. TornPDA is the lightweight mobile frontend and alert layer.

## High-Level Architecture

1. Weav3r provides marketplace listing data for watched items.
2. The backend fetches and processes watched item data on a repeating interval.
3. The backend stores watch settings, current state, prior alert state, and lightweight history.
4. The TornPDA userscript polls the backend for already-processed results.
5. TornPDA displays watch status and alerts the user when conditions are met.

## Important Design Rule

Do not place heavy market processing logic in the TornPDA script if it can live in the backend. TornPDA should stay lightweight.

## Core Features

- Watch multiple items at once
- Per watch configuration:
  - `itemId`
  - `itemName`
  - `targetPrice`
  - `nearMissGap`
  - `enabled`
- Alert types:
  - `BUY_NOW`
    Trigger when the lowest valid listing is less than or equal to `targetPrice`
  - `NEAR_MISS`
    Trigger when the cheapest listing above target is within `nearMissGap`
- Alert spam prevention:
  - do not repeat the same alert every poll cycle
  - only re-alert when the condition clears and returns, the price improves meaningfully, or cooldown expires
- TornPDA display fields:
  - item name
  - target price
  - near-miss gap
  - current lowest listing
  - current lowest listing above target
  - difference from target
  - state
  - last checked time
  - whether alert has already fired
- Optional lightweight history:
  - recent seen prices
  - lowest seen price in session
  - basic trend direction
  - timestamped event log

## Watch Evaluation Rules

Inputs:

- `targetPrice`
- `nearMissGap`
- current listings from Weav3r

Processing:

1. Sort listings by ascending price
2. Determine `lowestPrice`
3. Determine cheapest listing `<= targetPrice`
4. Determine cheapest listing `> targetPrice`
5. Compute:
   - `buyNow = lowestPrice <= targetPrice`
   - `nearMiss = lowestAboveTarget exists && (lowestAboveTarget - targetPrice) <= nearMissGap`
6. Assign overall state:
   - `BUY_NOW` if `buyNow`
   - `NEAR_MISS` if not `buyNow` and `nearMiss`
   - `WAIT` otherwise

Important:

- Use the same fetched listing dataset for both `BUY_NOW` and `NEAR_MISS`
- Do not make extra market calls just because a trigger condition is hit

## Backend Requirements

- Use Node.js
- Use Express
- Start with local JSON or SQLite storage
- Poll watched items on a fixed interval
- Keep modules separated:
  - config manager
  - Weav3r client
  - watch evaluator
  - alert state manager
  - TornPDA response formatter
- Fail gracefully:
  - request failures must not crash the app
  - failed items should be marked stale
  - last successful result should be preserved
- Add logging for:
  - successful fetches
  - failed fetches
  - alert transitions
  - item state changes

## Suggested Backend Endpoints

- `GET /api/watches`
- `GET /api/watch/:itemId`
- `POST /api/watches`
- `PUT /api/watch/:itemId`
- `DELETE /api/watch/:itemId`
- `GET /api/status`

## Suggested Watch Result Shape

```json
{
  "itemId": 123,
  "itemName": "Example Item",
  "targetPrice": 500,
  "nearMissGap": 200,
  "lowestPrice": 480,
  "lowestAboveTarget": 700,
  "differenceAboveTarget": 200,
  "state": "BUY_NOW",
  "buyNow": true,
  "nearMiss": true,
  "lastChecked": "ISO timestamp",
  "stale": false,
  "alertState": {
    "buyNowFired": true,
    "nearMissFired": false,
    "lastAlertedAt": "ISO timestamp"
  }
}
```

## TornPDA Userscript Requirements

- Poll only the backend, not Weav3r directly
- Show a simple clean panel inside TornPDA
- Refresh on an interval
- Display all watched items clearly
- Show strong visual state styling for:
  - `WAIT`
  - `NEAR_MISS`
  - `BUY_NOW`
- Alert behavior:
  - visible banner or overlay
  - optional sound
  - optional vibration if supported
  - clear item identification
- Include manual refresh
- Include a market-page link if possible

## Performance Expectations

- Keep v1 small and reliable
- Start with about 6 watched items
- Start with about a 10-second backend refresh interval
- Avoid duplicate requests
- Leave room for retries and future features

## Important Limitation

Weav3r should be treated as very useful market data, but not assumed to be perfect real-time truth down to the exact second. The system should remain robust even when data is slightly delayed or incomplete.

## Non-Goals For V1

- No user account system
- No cloud multi-user architecture
- No complex auth beyond simple private/local protection
- No large historical database
- No autonomous sniping or direct market action automation

## Desired V1 Outcome

A usable local/private system that:

- watches selected items
- tells the user when to buy
- tells the user when a listing is close enough to matter
- works with TornPDA open on a phone
- keeps heavy logic in the backend

## Preferred Stack

- Node.js
- Express
- Simple local storage first
- Plain JavaScript is acceptable
- TypeScript is acceptable only if kept simple

## Repository Expectations

The repo should contain:

- `backend/`
- `tornpda-script/`
- `memory/`
- `README.md`
- `.env.example`
- sample config
- setup instructions
- maintainable project-memory files

## Continuity Requirement

The repository must remain understandable to a brand-new agent with no chat history. Memory files are part of the implementation, not optional docs.

