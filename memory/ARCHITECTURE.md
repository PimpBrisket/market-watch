# Architecture

## High-Level Design

The project now has three layers.

### 1. Backend

Responsible for:

- persistent slot storage
- global watching ON/OFF state
- Weav3r fetching
- source-mode separation
- alert evaluation
- active listing memory
- duplicate suppression
- activity history
- backup export or import
- version metadata for compatibility checks

### 2. TornPDA Script

Responsible for:

- connection testing
- mobile UI
- compact vs manage mode
- last-known-good restore
- local notification preference
- backup export or import UI
- version mismatch warnings
- device-side banners and supported notifications

### 3. Desktop Viewer v1

Responsible for:

- desktop-first monitoring layout
- occupied-slot dashboard view
- alert inbox with recent alert history
- resizable side detail panel
- source-specific Market or Bazaar listing tables, including on-demand source switching for the selected item
- compact top status bar with connection, version, timing, and notification info
- current active alerts panel
- last-known-good display preservation during temporary refresh failures
- persistent layout preferences such as selected slot, panel state, active filter, and notification toggle

## Canonical Data Rules

Canonical backend state:

- slots
- runtime settings
- global watching active or inactive state
- processed watch results
- activity log

Local TornPDA support state:

- backend URL
- compact or manage mode
- notification toggle
- cached last-known-good slot payload

Fresh page loads intentionally start closed even if the previous session ended open.
When TornPDA reinjects after a page change, the script restores the last known good payload first and then force-syncs live backend state so backend watch status wins over cached UI defaults.

Desktop Viewer v1 keeps the same principle:

- no independent watch persistence
- no parallel source-of-truth state
- temporary in-memory UI state only for selected slot, connection status, and last known good payloads

Persisted desktop layout state is intentionally UI-only:

- selected slot
- side panel open or minimized state
- side panel width
- active filter
- alert inbox state
- desktop notification toggle

## Source-Mode Model

Each occupied slot stores exactly one source mode:

- `MARKET_ONLY`
- `BAZAAR_ONLY`

That source mode drives:

- `BUY_NOW`
- `NEAR_MISS`
- cheapest listing
- current listing display
- active low-listing memory
- duplicate suppression

There is no mixed-source alert evaluation.

Enabled slot toggles are preferences only. They matter only while backend global watching is ON.

## Versioning Model

Backend version:

- stored in `backend/src/version.js`
- exposed through `/api/status`
- included in `/api/slots`

Script version:

- stored in the userscript header `@version`
- mirrored by `SCRIPT_VERSION` in the userscript runtime
- validated during `npm run build:tornpda-export`

Compatibility model:

- script requires a minimum backend version
- backend exposes a minimum compatible script version
- incompatible versions trigger a visible warning
- risky actions are disabled instead of silently failing

## Global Watching Model

The backend owns the only real polling switch.

- startup defaults `watchingActive` to `false`
- `POST /api/watching/start` enables backend polling
- `POST /api/watching/stop` disables backend polling
- `POST /api/refresh` is blocked while global watching is OFF

Important consequence:

- per-slot `enabled` flags do not create their own background watchers
- enabled slots become active only when global watching is ON
- when global watching is OFF, occupied slots render as `IDLE`

TornPDA reconciliation rule:

- the userscript must not treat reinjection as proof that watching stopped
- init, menu reopen, and TornPDA-ready reinjection paths re-read backend watch state
- if sync fails, the UI may be marked stale or disconnected, but it should keep the last known good watch state instead of falsely downgrading to stopped

## Backup Model

Backend export shape:

- `formatVersion`
- `exportedAt`
- `backend.settings`
- `backend.slots`

Frontend export adds:

- `application.scriptVersion`
- `application.backendVersion`
- `application.minimumCompatibleBackendVersion`
- `application.minimumCompatibleScriptVersion`
- `uiPreferences.backendUrl`
- `uiPreferences.viewMode`
- `uiPreferences.appNotificationsEnabled`

Import flow:

1. frontend validates outer JSON shape
2. backend validates slot and settings payload
3. backend replaces canonical slot data
4. frontend restores safe local UI preferences
5. frontend re-renders canonical slot state

## Activity History

Activity entries are kept in backend meta storage and surfaced to the client.

Examples:

- item added
- item removed
- slot updated
- mode switched
- qualifying listing detected
- qualifying listing removed
- alert triggered
- backup imported

The log is bounded and intended for recent operator-facing history, not deep analytics.

Alert-trigger activity now includes enough detail for desktop or TornPDA formatting:

- source mode
- target price
- listed price
- quantity
- total cost when quantity > 1
- listing count
- seller metadata when available
- event ID for desktop notification dedupe

## Session Stats Model

The backend now tracks lightweight per-slot watcher session stats in `meta.session`.

Rules:

- a new session starts when global watching starts
- stats clear when global watching stops
- stats can be reset manually from the desktop viewer
- stats are for the current watch session only, not lifetime history

Tracked values:

- lowest listing found
- highest listing found
- total alerted quantity below target
- total listings found
- total near-misses found
- total alerts
- last checked
- current source mode

## Main Files

Backend:

- `backend/src/config.js`
- `backend/src/version.js`
- `backend/src/repositories/watchRepository.js`
- `backend/src/services/watchEvaluator.js`
- `backend/src/services/alertStateManager.js`
- `backend/src/services/watchRunner.js`
- `backend/src/routes/statusRouter.js`
- `backend/src/routes/watchesRouter.js`

Frontend:

- `desktop-viewer/index.html`
- `desktop-viewer/styles.css`
- `desktop-viewer/app.js`
- `tornpda-script/tornpda-market-watcher.user.js`
- `tornpda-script/tornpda-market-watcher.json`
- `scripts/build-tornpda-export.js`

## Alert Presentation

The backend remains responsible for determining the current valid qualifying listing set.

- immediate `BUY_NOW` events are built from the current active qualifying listings, not only the newly discovered delta
- the lead alert listing is the lowest currently valid qualifying listing at event creation time
- the userscript and desktop viewer render alerts as `[Market] 10x Item $350>$250($2,500)` style summaries
- if more current qualifying listings remain, the userscript adds a second line such as `+3 Listings available`
- the additional count excludes stale or disappeared listings and excludes the lead listing itself

## TornPDA Menu Shell

The TornPDA panel uses a sticky top bar inside the scrolling menu container.

- the top bar stays visible while scrolling
- the old `Hide` button was replaced by a compact right-side arrow control
- the current stable implementation prioritizes immediate scrolling on reopen over fragile scroll-position replay

## Desktop Viewer Shell

Desktop Viewer v1 is served by the backend at `/viewer`.

- `GET /viewer` serves `desktop-viewer/index.html`
- `GET /viewer/app.js` serves the viewer client
- `GET /viewer/styles.css` serves the desktop styling
- `GET /viewer/health` serves a diagnostics page
- `GET /viewer/health.json` exposes diagnostic JSON for the health page
- `GET /api/slot/:slotNumber/listings?sourceMode=...` fetches on-demand Market or Bazaar listing data for the selected desktop panel view

The layout is intentionally desktop-first:

- top bar for connection, version, and timer status
- main watched-slot area for occupied watches only
- optional Compact Mode for dense one-screen rows with a separate persistent field-visibility config
- right-side detail panel for the selected slot
- active alerts panel near the dashboard instead of a raw debug wall

The desktop client reuses existing backend routes first:

- `GET /api/status`
- `GET /api/slots`
- `POST /api/watching/start`
- `POST /api/watching/stop`
- `POST /api/refresh`

No separate desktop-only backend architecture was introduced for v1.

## Request Flow

### Connection test

1. userscript validates base URL
2. userscript calls:
   - `/health`
   - `/api/status`
   - `/api/slots`
3. UI stores endpoint diagnostics and version metadata

### Manual refresh

1. userscript calls `POST /api/refresh`
2. backend refreshes enabled occupied slots
3. userscript re-syncs `/api/slots`

### Desktop viewer refresh

1. desktop viewer renders immediately with any last known good in-memory payload
2. desktop viewer requests `/api/status`
3. desktop viewer requests `/api/slots`
4. if global watching is ON, `Refresh Now` may call `POST /api/refresh`
5. if global watching is OFF, the viewer only reloads status and slot state and shows `Not scheduled`
6. temporary failures keep the previous payload visible and mark the connection as failed or stale instead of blanking the dashboard

### Backup import

1. user pastes export JSON into TornPDA
2. userscript validates the outer shape
3. userscript calls `POST /api/backup/import`
4. backend validates and replaces canonical slot config
5. userscript restores safe UI preferences and re-renders
