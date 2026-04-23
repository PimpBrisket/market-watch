# Handoff

## Final Snapshot

The project is now in a publishable, version-aware state.

Current versions:

- Backend `1.8.1`
- TornPDA script `1.8.1`

## What Was Added In The Final Pass

- explicit backend version constants in `backend/src/version.js`
- backend-exposed minimum compatible script version
- script-side minimum backend version check
- visible version mismatch warning in the UI
- disabled risky actions when versions are incompatible
- backend backup export route
- backend backup import route
- frontend export or import UI
- compact About section
- lightweight recent activity panel
- simplified alert text in the form `[Market] 22x Item | $Price`
- second-line `+N Listings available` counts from current valid qualifying listings only
- sticky top bar with a right-side collapse arrow replacing the old `Hide` button
- in-menu scroll position restore on collapse or reopen within the same page session
- clearer per-slot status labels for:
  - loading
  - no listings found
  - fetch failed
  - stale data
- repo cleanup updates:
  - stronger `.gitignore`
  - generic example URLs instead of a personal LAN IP

## Key Files To Start With

- `backend/src/version.js`
- `backend/src/config.js`
- `backend/src/repositories/watchRepository.js`
- `backend/src/routes/statusRouter.js`
- `backend/src/routes/watchesRouter.js`
- `backend/src/services/watchRunner.js`
- `tornpda-script/tornpda-market-watcher.user.js`
- `scripts/build-tornpda-export.js`
- `README.md`

## Validation Already Completed

Backend and packaging:

- `npm run check`
- `npm run build:tornpda-export`
- `node --check tornpda-script/tornpda-market-watcher.user.js`

Covered by automated backend checks:

- add
- edit
- delete
- reset
- backup export
- backup import
- strict Bazaar or Market behavior
- same-slot source switching
- false-alert suppression
- duplicate suppression
- version metadata exposure
- activity log population

Covered by local userscript harness checks in this session:

- fresh load starts closed
- listing panels stay collapsed by default
- `Show Market Listings` works
- `Show Bazaar Listings` works
- alert text formatting matches the simplified source plus quantity pattern
- extra listing counts only reflect still-present qualifying listings
- sticky top bar renders and the old `Hide` button is removed
- the sticky-bar regression that hid the slot list was fixed before Git push
- reopening the menu now scrolls normally on the first swipe
- compact mode remains usable
- timing strip renders
- notification toggle persists

## Final UI Stability Fix

The first sticky-header implementation caused two regressions:

- the slot list could be pushed out of the normal visible flow because too much of the panel was wrapped in the sticky container
- reopening could feel unresponsive because scroll restoration was applied at the wrong moment

The final pre-push fix keeps the sticky top bar and arrow, but:

- limits sticky behavior to the header only
- keeps the 6-slot list in the normal menu flow
- removes the fragile reopen scroll-restore behavior
- resets to a stable top position on reopen so touch scrolling starts immediately

## Remaining Manual Validation

Do one final on-device TornPDA pass:

1. import `tornpda-script/tornpda-market-watcher.json`
2. confirm version `1.8.1`
3. enter base URL `http://YOUR-LAN-IP:3000`
4. test add, edit, delete
5. test `Market Only` and `Bazaar Only`
6. test `Open market`
7. test `Open Bazaar`
8. test export and import
9. test version warning behavior if you intentionally mismatch backend or script

## Important Safety Notes

- `.env` should remain local only
- `backend/data/store.json` should remain local only
- the repo now uses generic example URLs and should not hardcode a personal LAN IP
- the userscript export build now validates that `SCRIPT_VERSION` matches the userscript `@version`

## Good Next Step After Publishing

Implement the automatic update flow on top of the version-compatibility layer that now exists.
