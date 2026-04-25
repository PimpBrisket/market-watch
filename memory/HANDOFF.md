# Handoff

## Final Snapshot

The project now has a third client layer: Desktop Viewer v1. It remains in the same repo, is served by the same backend, and does not replace the TornPDA script.

Current versions:

- Backend `1.8.7`
- TornPDA script `1.8.7`

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
- desktop viewer route at `/viewer`
- occupied-slot-only desktop monitoring dashboard
- resizable side detail panel with source-specific listing tables
- desktop top status bar with connection, timing, and notification info
- active alerts panel for current interesting deals
- alert inbox with last-10 history and live additions while watching
- watcher-session stats per slot for the current active session only
- desktop watched-slot filters
- desktop browser notifications with permission-aware fallback
- `/viewer/health` diagnostic page with `/viewer/health.json` data route
- backend-owned global watching state with startup default OFF
- shared alert text in the form `[Market] 10x Item $350>$250($2,500)`
- second-line `+N Listings available` counts from current valid qualifying listings only
- sticky top bar with a right-side collapse arrow replacing the old `Hide` button
- clearer per-slot status labels for:
  - loading
  - no listings found
  - fetch failed
  - stale data
- TornPDA reinjection now re-syncs backend global watching state instead of falsely showing stopped after navigation
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
- `desktop-viewer/app.js`
- `desktop-viewer/index.html`
- `desktop-viewer/styles.css`
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
- desktop viewer route and static asset serving
- desktop viewer health page and JSON diagnostics route
- backend starts with global watching OFF
- `/api/refresh` is blocked while watching is OFF
- `POST /api/watching/start` enables polling
- `POST /api/watching/stop` stops polling and returns slots to IDLE
- watcher-session stats reset on stop and can be reset manually

Covered by local desktop-viewer harness checks in this session:

- helper module loads in Node without a browser dependency
- full desktop render boots with mocked `/api/status` and `/api/slots` payloads
- occupied-slot filtering and alert formatting helpers behave correctly in Node
- alert formatting stays source-aware and compact
- source-specific listing-state helpers distinguish Market and Bazaar correctly
- slot selection resolves correctly for requested or fallback slots
- timer helpers produce useful `Waiting`, `Ready now`, and countdown text
- the desktop alert panel logic uses current qualifying listing data
- the desktop viewer shows `Idle` / `Not scheduled` while backend watching is OFF
- fallback handling keeps the viewer visible during API failures

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
- reinjection no longer forces cached watch state back to inactive

## TornPDA UI Stability Fix

The first sticky-header implementation caused two regressions:

- the slot list could be pushed out of the normal visible flow because too much of the panel was wrapped in the sticky container
- reopening could feel unresponsive because scroll restoration was applied at the wrong moment

The final pre-push fix keeps the sticky top bar and arrow, but:

- limits sticky behavior to the header only
- keeps the 6-slot list in the normal menu flow
- removes the fragile reopen scroll-restore behavior
- resets to a stable top position on reopen so touch scrolling starts immediately

## Desktop Viewer v1 Notes

Desktop Viewer v1 is intentionally a monitoring-oriented foundation, not a full second control surface.

- access it at `/viewer` from the same backend host
- it reuses `/api/status`, `/api/slots`, and `POST /api/refresh`, plus a small on-demand listing route
- it keeps only occupied slots in the main watched area
- clicking a slot opens the resizable side panel on the right
- the side panel can minimize to a bottom restore chip or close fully
- the side panel view dropdown switches between Market listings, Bazaar listings, Latest Alerts, and Watcher Info
- Bazaar slots show seller-aware bazaar rows when available
- Market slots show market rows without forcing Bazaar-only fields
- temporary refresh failures keep the last known good dashboard visible and surface a connection or stale state instead of blanking the UI
- global watching timers now come from backend status rather than local UI inference
- desktop alert inbox and browser notifications are driven by backend alert activity
- Compact Mode can replace the normal watched-slot cards with dense clickable rows
- Compact Mode has its own persistent `Edit View` field toggles and does not change the normal desktop layout

## Desktop Viewer Side-Panel Interaction Fix

After the side-panel upgrade, two desktop-specific interaction issues showed up:

- the native panel-view dropdown could close itself because the viewer was re-rendering during active interaction
- scroll could bleed into the page behind the panel, especially when the panel was open for a while

The current fix does this:

- defers full viewer re-renders while the panel dropdown is focused or actively being opened
- keeps the selected panel view stable across background refreshes
- locks document scroll while the side panel is open
- makes the panel content the primary scroll container with contained overscroll
- removes the scroll lock when the panel is minimized or closed, then reapplies it when restored

## Global Watching Fix

The previous setup could still poll in the backend even when the user thought watching was stopped.

The fix centralizes control in the backend:

- backend startup now forces global watching OFF
- `Start Watching` from TornPDA calls backend start instead of creating a local polling loop
- `Stop Watching` from TornPDA calls backend stop and disables all slot activity
- per-slot enabled toggles stay as preferences until global watching is ON
- desktop viewer timing cards now show `Not scheduled` when the backend is stopped

## TornPDA Re-Sync Fix

After page navigation or reinjection, TornPDA could falsely show `Start Watching` even while the backend and desktop viewer still showed watching ON.

That is now fixed by:

- preserving cached backend watch state instead of forcing it to `INACTIVE`
- force-syncing backend slot and status payloads on userscript init when a backend URL exists
- force-syncing again when TornPDA fires the platform-ready reinjection event
- force-syncing on `Open Menu`

If the backend cannot be reached, the script should keep the last known good watch state visible and show a stale or disconnected condition instead of falsely implying that the backend stopped.

## Desktop Viewer White-Screen Fix

The first `/viewer` release had a pathing bug that could produce a blank white page.

Cause:

- the HTML shell used relative `./app.js` and `./styles.css` links
- from the URL `/viewer`, those paths did not reliably resolve to the mounted `/viewer/...` assets
- because the shell root started empty, a failed script load looked like a totally blank page

Fix:

- `desktop-viewer/index.html` now links to absolute `/viewer/styles.css` and `/viewer/app.js`
- the initial HTML now includes a visible `Loading viewer...` shell
- fatal startup errors now render a visible `Error loading viewer` panel
- `backend/src/app.js` now exposes `/viewer/health` for quick route or asset verification

Correct access URLs:

- desktop viewer: `http://127.0.0.1:3000/viewer`
- viewer health: `http://127.0.0.1:3000/viewer/health`

## Version Label Fix

After the metadata-only `1.8.2` bump, the menu still showed `1.8.1` for both Script and Backend in some flows.

The final fix does this:

- Script label comes from the installed userscript metadata header at runtime
- Backend label comes from live backend version payloads, not cached UI restore state
- cached slot restore no longer keeps stale version labels alive across refresh or reopen
- the About section now falls back to `Loading...` or `Unknown` until fresh live data arrives

## Remaining Manual Validation

Do one final validation pass:

1. desktop browser:
2. open `/viewer`
3. confirm slot layout, detail panel, alert panel, and `Idle` / `Not scheduled` startup state with real data
4. confirm Bazaar and Market listings look correct once watching is started
5. TornPDA:
6. import `tornpda-script/tornpda-market-watcher.json`
7. confirm version `1.8.7`
8. enter base URL `http://YOUR-LAN-IP:3000`
9. test add, edit, delete
10. confirm global watching starts OFF
11. test `Start Watching` and `Stop Watching`
12. test `Market Only` and `Bazaar Only`
13. test `Open market`
14. test `Open Bazaar`
15. test export and import
16. test version warning behavior if you intentionally mismatch backend or script

## Important Safety Notes

- `.env` should remain local only
- `backend/data/store.json` should remain local only
- the repo now uses generic example URLs and should not hardcode a personal LAN IP
- the userscript export build now validates that `SCRIPT_VERSION` matches the userscript `@version`

## Good Next Step After Publishing

Implement the automatic update flow on top of the version-compatibility layer that now exists.
