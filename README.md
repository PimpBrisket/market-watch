# TornPDA Market Watcher

TornPDA Market Watcher is a local Torn market-tracking tool with a Node.js backend, a TornPDA userscript frontend, and a desktop-first browser viewer served from the same backend.

The backend does the important work:

- polling Weav3r
- owning the global watching ON/OFF state
- separating true `Market Only` vs `Bazaar Only` data
- evaluating `BUY_NOW`, `NEAR_MISS`, and `WAIT`
- suppressing duplicate alerts for the same still-active listing
- keeping slot state canonical

The clients stay lightweight:

- TornPDA: mobile UI, connection testing, slot setup, compact tracking, local restore of last known good state, in-app or supported device notifications
- Desktop Viewer v1: desktop monitoring dashboard, selected-slot detail panel, source-specific listing tables, top status bar, and active alert visibility

Current release:

- Backend version: `1.8.6`
- TornPDA script version: `1.8.6`

## Features

- Fixed 6-slot watcher model
- Global watching starts OFF on backend startup
- Per-slot `Market Only` / `Bazaar Only` source toggle
- True source separation for alerts, cheapest listing, near-miss logic, and duplicate suppression
- Immediate alerting for newly seen qualifying low listings
- Active qualifying-listing memory so the same current listing does not spam every poll
- Automatic removal of active listing memory when that listing disappears
- Manual `Show Market Listings` / `Show Bazaar Listings` panels
- Shared alert formatting such as `[Market] 10x Cell Phone $350>$250($2,500)`
- Additional qualifying-listing counts on a second alert line when more current matches exist
- Startup-closed TornPDA menu with compact and manage modes
- Sticky menu top bar with a right-side collapse arrow
- Last-known-good UI restore without wiping slot cards on temporary failures
- Version display plus backend or script compatibility warnings
- Export and import backup flow for backend slots plus local UI preferences
- Lightweight recent activity log
- Desktop Viewer v1 served at `/viewer`
- Desktop watched-slot grid that shows occupied slots only
- Desktop side detail panel with Market/Bazaar listing views, per-item alerts, and watcher info
- Desktop alert inbox with last-10 alert history and live additions while watching
- Desktop top status bar for backend connection, versions, timing info, and notification status
- Desktop browser notifications with permission-aware fallback behavior
- Dedicated `/viewer/health` diagnostic page

## Source Modes

`Market Only`

- uses Weav3r Item Market rows only
- does not use bazaar seller rows
- keeps seller identity unavailable because Item Market rows are anonymous

`Bazaar Only`

- uses Weav3r bazaar seller rows only
- does not use Item Market rows
- can show seller names and `Open Bazaar` when the upstream data includes enough information

## Version Safety

The project is now version-aware for future auto-update work.

- The script knows the minimum backend version it can safely use
- The backend exposes the minimum script version it supports
- If the versions are incompatible, TornPDA shows a clear warning instead of silently failing
- Risky actions are disabled until the backend or script is updated

## Setup

### 1. Install dependencies

```powershell
Set-Location 'C:\Users\Anthony\Downloads\Torn'
Copy-Item .env.example .env
npm install
```

### 2. Start the backend

```powershell
Set-Location 'C:\Users\Anthony\Downloads\Torn'
npm run dev
```

Global watching starts OFF every time the backend starts. Slots and preferences are still loaded, but no market polling runs until you press `Start Watching`.
If TornPDA reloads or reinjects after a page change, it now re-syncs current backend watch state automatically so the menu does not falsely fall back to `Start Watching` while the backend is still active.

### 3. Verify the backend locally

Open:

- `http://127.0.0.1:3000/health`
- `http://127.0.0.1:3000/api/status`

### 4. Open the desktop viewer

With the backend running, open:

- `http://127.0.0.1:3000/viewer`

The desktop viewer uses the same backend state as TornPDA and is intended for wider monitoring on a computer screen.

If you want a quick viewer-specific sanity check, open:

- `http://127.0.0.1:3000/viewer/health`

That route confirms the backend is serving the desktop viewer shell plus the expected JS and CSS asset paths.

### 5. Import the TornPDA script

In TornPDA:

1. Open `Settings -> Advanced Browser Settings -> Manage Scripts`
2. Import [tornpda-script/tornpda-market-watcher.json](/c:/Users/Anthony/Downloads/Torn/tornpda-script/tornpda-market-watcher.json)
3. Make sure the imported script version shows `1.8.6`

### 6. Enter the backend base URL

Use the base URL only, for example:

- `http://YOUR-LAN-IP:3000`

Do not enter:

- `/api/status`
- `/api/slots`
- `/health`

## Daily Use

Desktop Viewer v1:

- `/viewer` shows only occupied watched slots so the main dashboard stays dense
- the page now starts with a visible `Loading viewer...` shell instead of a blank white screen
- when global watching is OFF, the viewer shows `Idle` / `Not scheduled` instead of a live polling countdown
- click any watched slot to open the resizable side detail panel on the right
- the side panel can be minimized to a bottom restore chip or closed completely
- the side panel dropdown can switch between Market listings, Bazaar listings, item-specific latest alerts, and current-session watcher info
- the alert inbox button opens the last 10 alert entries and toggles to `Close` while open
- Bazaar slots can show seller-aware bazaar rows with `Open Bazaar` when available
- Market slots can show market rows without forcing Bazaar-only fields
- desktop notifications can be enabled or disabled separately from TornPDA notifications
- watched-slot filters can focus the dashboard on BUY NOW, Near Miss, Market, Bazaar, Watching, or Stale/Error states
- `Refresh Now` in the top bar runs one immediate sync while regular polling stays lightweight
- temporary backend failures keep the last known good desktop state on screen and mark the connection as stale or failed instead of blanking the UI
- if the client fails very early, the page now shows `Error loading viewer` instead of an empty page

- `Open Menu` opens the watcher
- The sticky top bar stays pinned while you scroll inside the menu
- The right-side arrow in that bar hides the menu
- `Start Watching` is required before any backend market polling occurs
- `Stop Watching` disables all slot activity immediately, even if individual slot toggles remain enabled
- slot enable or disable toggles are stored preferences, not independent background watchers
- `Refresh Now` is only available while global watching is ON
- `Reload Saved Slots` re-reads canonical backend state without starting a backend poll
- `Start Watching` begins backend polling for enabled occupied slots
- `Stop Watching` stops backend polling for all slots
- Fresh loads start with the menu closed
- Listing panels stay collapsed until you press `Show Market Listings` or `Show Bazaar Listings`
- Reopening the menu restores the last in-menu scroll position during the current page session

## Alert Format

`BUY_NOW` alerts are now intentionally compact:

- `[Market] 13x Cell Phone $350>$220 6:20pm`
- `[Bazaar] 4x Morphine $4,800,000>$4,300,000 6:22pm`

When the listing quantity is `2` or more, the single-item listed price keeps showing and the total quantity cost appears beside it:

- `[Market] 10x Cell Phone $350>$250($2,500)`

If more currently present qualifying listings are still available under the target, the alert adds:

- `+3 Listings available`

The extra count only includes still-valid listings in the current active snapshot and does not count the main alerted listing twice.

## Backup And Restore

Full configuration backup is available from the TornPDA UI.

Export includes:

- all 6 slots
- target prices
- near-miss values
- source mode per slot
- enabled state
- notification preference
- main local UI preferences
- saved backend URL

Import behavior:

- validates JSON before applying
- validates backend slot data before replacing the current config
- restores local UI preferences safely
- keeps backend slot storage canonical

## Activity History

The UI includes a small recent activity section with entries such as:

- item added
- item removed
- slot updated
- source mode switched
- alert triggered
- qualifying listing detected
- qualifying listing removed

The log is intentionally lightweight and bounded.

## Repository Structure

- `backend/`
  Express backend, repository, evaluator, global watch-state control, desktop viewer hosting, and checks
- `desktop-viewer/`
  Desktop Viewer v1 static HTML, CSS, and JS served by the backend at `/viewer`
- `tornpda-script/`
  Userscript source plus TornPDA import JSON
- `scripts/`
  Helper scripts such as TornPDA export generation
- `memory/`
  Current status, architecture, decisions, setup notes, TODO, and handoff docs

## Checks

Run:

```powershell
Set-Location 'C:\Users\Anthony\Downloads\Torn'
npm run check
npm run build:tornpda-export
```

What `npm run check` covers right now:

- add
- edit
- delete
- reset
- backup export
- backup import
- duplicate blocking
- strict Bazaar vs Market separation
- same-slot source switching
- false-positive suppression
- active listing cleanup
- immediate first-seen low-listing alerts
- desktop viewer route and static asset serving

## Known Limitations

- Weav3r data can be delayed, cached, or partial depending on the upstream source
- `Bazaar Only` quality depends on what seller information Weav3r currently exposes
- `Market Only` rows are anonymous, so seller identity is not available there
- the original Desktop Viewer white-screen issue was caused by relative asset paths from `/viewer`; the viewer now uses absolute `/viewer/...` asset URLs and a visible boot shell
- Desktop Viewer v1 is intentionally monitoring-focused for now:
  - it does not add charts, predictors, or heavy analytics yet
  - it currently reuses existing backend endpoints plus a small on-demand listing route instead of introducing a separate frontend API
- desktop and TornPDA polling displays now depend on the backend global watching state, so stale cached UI state should no longer imply that active polling is still running
- Final real-device TornPDA tap-through validation is still recommended for:
  - `Open Bazaar`
  - `Open market`
  - compact layout feel on your phone
- Automatic self-update delivery is not implemented yet, but the version and compatibility groundwork is now in place

## Security Notes

- `.env` is local-only and should not be committed
- `backend/data/store.json` is local-only and gitignored
- Repo files use example URLs like `http://YOUR-LAN-IP:3000`
- No personal LAN IP needs to be hardcoded in source files
