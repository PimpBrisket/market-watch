# TornPDA Market Watcher

TornPDA Market Watcher is a local Torn market-tracking tool with a Node.js backend and a TornPDA userscript frontend.

The backend does the important work:

- polling Weav3r
- separating true `Market Only` vs `Bazaar Only` data
- evaluating `BUY_NOW`, `NEAR_MISS`, and `WAIT`
- suppressing duplicate alerts for the same still-active listing
- keeping slot state canonical

The TornPDA script stays lightweight:

- mobile UI
- connection testing
- slot setup
- compact tracking
- local restore of last known good state
- in-app or supported device notifications

Current release:

- Backend version: `1.8.1`
- TornPDA script version: `1.8.1`

## Features

- Fixed 6-slot watcher model
- Per-slot `Market Only` / `Bazaar Only` source toggle
- True source separation for alerts, cheapest listing, near-miss logic, and duplicate suppression
- Immediate alerting for newly seen qualifying low listings
- Active qualifying-listing memory so the same current listing does not spam every poll
- Automatic removal of active listing memory when that listing disappears
- Manual `Show Market Listings` / `Show Bazaar Listings` panels
- Simplified mobile alerts such as `[Market] 22x Cell Phone | $288`
- Additional qualifying-listing counts on a second alert line when more current matches exist
- Startup-closed TornPDA menu with compact and manage modes
- Sticky menu top bar with a right-side collapse arrow
- Last-known-good UI restore without wiping slot cards on temporary failures
- Version display plus backend or script compatibility warnings
- Export and import backup flow for backend slots plus local UI preferences
- Lightweight recent activity log

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

### 3. Verify the backend locally

Open:

- `http://127.0.0.1:3000/health`
- `http://127.0.0.1:3000/api/status`

### 4. Import the TornPDA script

In TornPDA:

1. Open `Settings -> Advanced Browser Settings -> Manage Scripts`
2. Import [tornpda-script/tornpda-market-watcher.json](/c:/Users/Anthony/Downloads/Torn/tornpda-script/tornpda-market-watcher.json)
3. Make sure the imported script version shows `1.8.1`

### 5. Enter the backend base URL

Use the base URL only, for example:

- `http://YOUR-LAN-IP:3000`

Do not enter:

- `/api/status`
- `/api/slots`
- `/health`

## Daily Use

- `Open Menu` opens the watcher
- The sticky top bar stays pinned while you scroll inside the menu
- The right-side arrow in that bar hides the menu
- `Refresh Now` runs one backend poll without starting continuous watching
- `Reload Saved Slots` re-reads canonical backend state without starting a backend poll
- `Start Watching` begins the repeating poll loop
- `Stop Watching` stops it
- Fresh loads start with the menu closed
- Listing panels stay collapsed until you press `Show Market Listings` or `Show Bazaar Listings`
- Reopening the menu restores the last in-menu scroll position during the current page session

## Alert Format

`BUY_NOW` alerts are now intentionally compact:

- `[Market] 22x Cell Phone | $288`
- `[Bazaar] 5x Morphine | $4,500,000`

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
  Express backend, repository, evaluator, alert logic, and checks
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

## Known Limitations

- Weav3r data can be delayed, cached, or partial depending on the upstream source
- `Bazaar Only` quality depends on what seller information Weav3r currently exposes
- `Market Only` rows are anonymous, so seller identity is not available there
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
