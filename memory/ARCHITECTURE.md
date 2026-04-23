# Architecture

## High-Level Design

The project has two layers.

### 1. Backend

Responsible for:

- persistent slot storage
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

## Canonical Data Rules

Canonical backend state:

- slots
- runtime settings
- processed watch results
- activity log

Local TornPDA support state:

- backend URL
- compact or manage mode
- notification toggle
- cached last-known-good slot payload

Fresh page loads intentionally start closed even if the previous session ended open.

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

- `tornpda-script/tornpda-market-watcher.user.js`
- `tornpda-script/tornpda-market-watcher.json`
- `scripts/build-tornpda-export.js`

## Alert Presentation

The backend remains responsible for determining the current valid qualifying listing set.

- immediate `BUY_NOW` events are built from the current active qualifying listings, not only the newly discovered delta
- the lead alert listing is the lowest currently valid qualifying listing at event creation time
- the userscript renders alerts as `[Market] 22x Item | $288` or `[Bazaar] 5x Item | $Price`
- if more current qualifying listings remain, the userscript adds a second line such as `+3 Listings available`
- the additional count excludes stale or disappeared listings and excludes the lead listing itself

## Menu Shell

The TornPDA panel uses a sticky top bar inside the scrolling menu container.

- the top bar stays visible while scrolling
- the old `Hide` button was replaced by a compact right-side arrow control
- collapsing the menu stores the current in-panel scroll position in runtime state
- reopening restores that scroll position within the same page session

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

### Backup import

1. user pastes export JSON into TornPDA
2. userscript validates the outer shape
3. userscript calls `POST /api/backup/import`
4. backend validates and replaces canonical slot config
5. userscript restores safe UI preferences and re-renders
