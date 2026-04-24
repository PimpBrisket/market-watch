# Current Status

## Overall State

As of 2026-04-24, the project includes a new Desktop Viewer v1 in the same repo and served by the same backend. The backend remains canonical, TornPDA remains the mobile client, and the desktop viewer is now the desktop monitoring client.

Current versions:

- Backend: `1.8.6`
- TornPDA script: `1.8.6`

## Confirmed Working

- 6-slot backend model
- backend startup defaults to global watching OFF
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
- shared alert text in the form `[Market] 10x Item $350>$250($2,500)`
- second-line `+N Listings available` counts from the current valid qualifying snapshot only
- lightweight recent activity log
- backup export
- backup import
- version display in the UI
- backend or script compatibility warning surface
- disabled risky actions when versions are incompatible
- Desktop Viewer v1 route at `/viewer`
- occupied-slot desktop watched grid
- resizable side detail panel
- source-correct Market and Bazaar listing tables
- desktop top status bar for connection, versions, and timing
- active alerts panel for current interesting deals
- polling-based desktop refresh that preserves last known good data on temporary failures
- global Start Watching and Stop Watching now control all backend polling
- enabled slot toggles now behave as preferences unless global watching is ON
- desktop `Next Check` and related timing labels now show `Not scheduled` while stopped
- TornPDA now re-syncs backend global watching state automatically after navigation, refresh, or reinjection
- desktop main view now shows occupied slots only instead of placeholder empty slots
- desktop alert inbox with last-10 history and alert button toggle
- shared alert format now uses `target>listed(total)` formatting, with total cost shown when quantity >= 2
- desktop side panel replaces the old bottom details area
- side panel supports Market listings, Bazaar listings, Latest Alerts, and current-session Watcher Info views
- current-session watcher stats reset automatically on Stop Watching
- desktop watched-slot filter menu is available from the Watched Slots panel
- `/viewer/health` is now a dedicated diagnostic page and `/viewer/health.json` backs it
- desktop browser notifications are available with persisted toggle state and graceful permission fallback

## Final Architecture Status

- Backend remains canonical for watches and processed state
- Backend global watching state is now canonical for whether polling may run at all
- TornPDA local persistence is only support state
- Desktop Viewer v1 is a thin browser client that reuses existing backend endpoints where possible
- Backup format now contains:
  - backend slot and settings payload
  - local UI preferences
  - version metadata
- `/api/status` and `/api/slots` both expose version metadata
- `/api/backup/export` and `/api/backup/import` now exist
- `/viewer` serves the desktop dashboard static client
- `/viewer/health` serves the diagnostic health page
- `/api/slot/:slotNumber/listings` serves on-demand Market or Bazaar listing data for the selected desktop panel view
- backend session stats now accumulate per slot only for the current watching session and clear on stop

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
- desktop viewer route and static asset serving are exposed correctly
- backend starts with watching OFF
- backend blocks `/api/refresh` while watching is OFF
- start watching enables global polling
- stop watching returns slots to IDLE state
- on-demand listing detail route returns source-correct listing tables
- current watch-session stats are created on Start Watching and cleared on Stop Watching

Covered by local desktop-viewer harness validation in this session:

- desktop viewer helper module loads successfully
- desktop viewer render path boots successfully with mocked backend data
- occupied-slot filtering keeps empty slots out of the main desktop watched area
- selecting a slot resolves to the requested or first occupied slot correctly
- Bazaar mode alert and listing logic stays separate from Market mode
- Market mode alert and listing logic stays separate from Bazaar mode
- top timing helpers produce useful `Waiting`, `Ready now`, and countdown-style labels
- active alert formatting stays compact and source-aware
- temporary failure handling is intentionally last-known-good-first rather than blanking the UI
- the viewer now shows a visible loading or error shell instead of rendering as a blank white page if startup fails
- the viewer shows `Idle` / `Not scheduled` while global watching is OFF
- the viewer switches back to active refresh labels only when global watching is ON
- occupied-slot filtering keeps empty slots out of the main desktop watched area
- shared alert formatting uses `target>listed(total)` style and compact local time in the desktop inbox
- desktop helper logic preserves layout preferences without overriding backend watch data

## Desktop Viewer UI Upgrade

Desktop Viewer v1 is now denser and more useful for active monitoring:

- the watched-slot area shows occupied items only
- the old bottom detail block is gone
- clicking a slot opens a resizable side panel instead
- the side panel can minimize to a bottom restore chip or close entirely
- Market listings, Bazaar listings, item-specific alert history, and watcher session stats now live in that panel
- a top-level `Alerts` button opens a compact inbox with the last 10 alert entries and live additions while watching
- desktop notifications now use the same compact alert format and respect permission state
- the viewer now has a small filter menu for common watch states and source types

## Watcher Session Stats

The backend now keeps lightweight per-slot session stats for the current watch session only.

They include:

- lowest listing found
- highest listing found
- total alerted quantity below target
- total listings found
- total near-misses found
- total alerts
- last checked
- source mode

These stats are reset:

- when Start Watching begins a new session
- when Stop Watching ends the current session
- when the user manually resets desktop session stats

## Global Watching Model Fix

The previous model had two conflicting truths:

- the backend started polling automatically on startup
- TornPDA kept its own local start or stop loop state

That could make the desktop viewer show active timing even when the user expected the system to be stopped, and enabled slot toggles could still appear active after Stop Watching.

This is now fixed by:

- making backend global watching state canonical
- forcing backend startup to default to OFF
- requiring `Start Watching` before any backend market polling can happen
- making `Stop Watching` disable all slot activity even if per-slot toggles remain enabled
- treating per-slot toggles as preferences until global watching is ON
- blocking backend `/api/refresh` while stopped so no hidden poll path remains

## Desktop Viewer White-Screen Fix

The initial `/viewer` rollout could load as a blank white page even though the backend route existed.

Root cause:

- `index.html` linked `./app.js` and `./styles.css`
- when the page was opened at `/viewer` without a trailing slash, the browser resolved those paths incorrectly instead of requesting `/viewer/app.js` and `/viewer/styles.css`
- if the JS never loaded, the page only contained an empty root node, which looked like a white screen

Fix:

- switched the desktop viewer shell to absolute asset paths:
  - `/viewer/app.js`
  - `/viewer/styles.css`
- added a visible `Loading viewer...` shell directly in `index.html`
- added startup-fatal rendering so early JS crashes show `Error loading viewer`
- added `/viewer/health` to confirm viewer shell and asset routing quickly
- kept the main dashboard shell visible during API failures instead of blanking the page

Covered by local userscript harness validation in this session:

- menu starts closed on fresh load
- listing panels stay collapsed by default
- `Show Market Listings` expands current market rows
- `Show Bazaar Listings` expands current bazaar rows
- alert headline formatting matches the shared `[Source] #x Item $Target>$Listed($Total)` pattern
- extra listing counts only come from currently active qualifying listings
- sticky top bar markup is present and the old `Hide` button is gone
- the sticky-bar regression that pushed slots out of normal view was fixed before Git push
- reopening the menu now resets to a stable top position so the first swipe works immediately
- notification toggle persists across reloads
- compact mode still renders source labels and listing controls cleanly
- timing strip renders `Next Check`, `Next Alert`, and `Next Notification`
- cached slot restore no longer forces the watch UI back to `INACTIVE`
- userscript init, TornPDA-ready reinjection, and `Open Menu` now force a fresh backend state sync when a backend URL is configured

## TornPDA Watching-State Re-Sync Fix

After the backend-controlled global watching rollout, TornPDA could still look stopped after a page refresh or page navigation even while the backend remained active.

Root cause:

- cached slot restore was forcing the local watcher state back to inactive defaults
- reinjection and menu reopen did not always force a live backend read

This is now fixed by:

- keeping backend global watching state authoritative
- preserving the last known backend watch state during cached restore
- force-syncing backend slot or status state on userscript init when a backend URL is configured
- force-syncing again on TornPDA reinjection and on `Open Menu`
- preserving the last known good visible state if the sync fails instead of falsely showing stopped

## Last Regression Fix

The first sticky-bar pass introduced two UI regressions:

- the sticky wrapper covered too much of the menu and made the 6-slot list effectively disappear from normal view
- reopening could feel touch-blocked because scroll position restoration was firing at the wrong time

These were fixed by:

- limiting the sticky treatment to the top bar only
- keeping the slot list in the normal scroll flow
- removing the fragile reopen scroll restoration path
- resetting the menu to a stable top position on reopen so touch scrolling works immediately

## Version Display Fix

The menu version labels had gone stale after the `1.8.1 -> 1.8.2` userscript update:

- the script label was still reading an outdated hardcoded runtime constant
- the backend label could persist old values from cached slot payloads

This is now fixed by:

- deriving the displayed script version from the installed userscript metadata header at runtime
- keeping backend version display tied to live `/api/status` or `/api/slots` version data
- excluding cached version labels from long-term restored UI state
- showing `Loading...` or `Unknown` until live backend version data is available

## Remaining Non-Code Validation Gap

The main remaining gaps are:

- live desktop browser-side interaction confirmation for the new viewer
- live phone-side TornPDA interaction confirmation for:

- `Open market`
- `Open Bazaar`
- final compact-mode readability on the device
- real WebView notification permission behavior

## Operational Notes

- `.env` stays local and gitignored
- `backend/data/store.json` stays local and gitignored
- example URLs should stay generic, such as `http://YOUR-LAN-IP:3000`
