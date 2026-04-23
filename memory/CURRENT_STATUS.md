# Current Status

## Overall State

As of 2026-04-23, the project is functionally complete and has now had a final stabilization and GitHub-readiness pass.

Current versions:

- Backend: `1.8.1`
- TornPDA script: `1.8.1`

## Confirmed Working

- 6-slot backend model
- add, edit, delete, enable or disable, and reset flows
- strict `Market Only` vs `Bazaar Only` separation
- same-slot source switching in both directions
- current-snapshot-only low-listing alerts
- active low-listing memory and duplicate suppression
- removal of stale active listing memory when listings disappear
- startup-closed TornPDA menu
- sticky menu top bar with collapse arrow
- manual `Show Market Listings` and `Show Bazaar Listings` panels
- compact timing strip
- persisted notification toggle
- simplified alert text in the form `[Market] 22x Item | $Price`
- second-line `+N Listings available` counts from the current valid qualifying snapshot only
- lightweight recent activity log
- backup export
- backup import
- version display in the UI
- backend or script compatibility warning surface
- disabled risky actions when versions are incompatible

## Final Architecture Status

- Backend remains canonical for watches and processed state
- TornPDA local persistence is only support state
- Backup format now contains:
  - backend slot and settings payload
  - local UI preferences
  - version metadata
- `/api/status` and `/api/slots` both expose version metadata
- `/api/backup/export` and `/api/backup/import` now exist

## Automated Validation Completed

- `npm run check`
- `node --check tornpda-script/tornpda-market-watcher.user.js`
- `npm run build:tornpda-export`

Covered by backend checks:

- adding items works
- editing works
- deleting works
- reset works
- slots persist correctly
- Bazaar or Market switching works
- listing detection stays source-correct
- stale ghost listings do not produce new buy alerts
- duplicate alerts do not spam every cycle
- backup export returns all slots
- backup import restores canonical state
- backend version metadata is exposed

Covered by local userscript harness validation in this session:

- menu starts closed on fresh load
- listing panels stay collapsed by default
- `Show Market Listings` expands current market rows
- `Show Bazaar Listings` expands current bazaar rows
- alert headline formatting matches the simplified `[Source] #x Item | $Price` pattern
- extra listing counts only come from currently active qualifying listings
- sticky top bar markup is present and the old `Hide` button is gone
- the sticky-bar regression that pushed slots out of normal view was fixed before Git push
- reopening the menu now resets to a stable top position so the first swipe works immediately
- notification toggle persists across reloads
- compact mode still renders source labels and listing controls cleanly
- timing strip renders `Next Check`, `Next Alert`, and `Next Notification`

## Last Regression Fix

The first sticky-bar pass introduced two UI regressions:

- the sticky wrapper covered too much of the menu and made the 6-slot list effectively disappear from normal view
- reopening could feel touch-blocked because scroll position restoration was firing at the wrong time

These were fixed by:

- limiting the sticky treatment to the top bar only
- keeping the slot list in the normal scroll flow
- removing the fragile reopen scroll restoration path
- resetting the menu to a stable top position on reopen so touch scrolling works immediately

## Remaining Non-Code Validation Gap

The main remaining gap is live phone-side TornPDA interaction confirmation for:

- `Open market`
- `Open Bazaar`
- final compact-mode readability on the device
- real WebView notification permission behavior

## Operational Notes

- `.env` stays local and gitignored
- `backend/data/store.json` stays local and gitignored
- example URLs should stay generic, such as `http://YOUR-LAN-IP:3000`
