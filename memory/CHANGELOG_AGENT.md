# Agent Changelog

## 2026-04-20

- Created initial repository scaffold for TornPDA Market Watcher
- Implemented JSON-backed Express backend with modular watch evaluation and alert logic
- Added TornPDA userscript that polls backend results and surfaces local alerts
- Added README, `.env.example`, sample data, and continuity docs under `memory/`
- Verified Weav3r response schema from a live marketplace endpoint before writing the parser
- Ran `npm install`, passed the smoke check, and validated live `/api/status` and `/api/watches` responses
- Documented that the live Weav3r payload exposed `total_listings` larger than the returned `listings[]` length
- Updated idle and disabled watch behavior so disabled entries stay visible without presenting active alert states

## 2026-04-21T18:28:48-04:00

- Rewrote all required `memory/*.md` files to match the stricter repository-memory contract
- Expanded memory docs with exact sections for working or partial or missing state, architecture flow, decisions, setup steps, and a sharper handoff
- Documented the exact next recommended action: real TornPDA mobile validation before more feature work
- Why: future agents should be able to continue from disk alone without relying on chat history or vague summaries

## 2026-04-21T18:40:00-04:00

- Added root-level `PROJECT_SPEC.md` to preserve the full product specification inside the repo
- Added root-level `AGENT_INSTRUCTIONS.md` to codify read order, memory-update rules, and scope boundaries for future agents
- Updated handoff and status docs to note that that pass was scaffold and docs only and did not extend implementation

## 2026-04-21T18:48:00-04:00

- Re-fetched a live Weav3r marketplace response from `https://weav3r.dev/api/marketplace/886`
- Documented the exact observed top-level and listing field names in `memory/ARCHITECTURE.md` and `memory/SETUP_NOTES.md`
- Recorded the latest observed sample values, including `total_listings = 194` and `listings.length = 100`
- Why: parser assumptions should stay tied to a real observed response instead of guessed field names

## 2026-04-21T18:52:00-04:00

- Audited the backend against the requested implementation order: config storage, Weav3r client, watch evaluator, alert state manager, REST endpoints, logging, and sample watch data
- Fixed the stale-result path in `backend/src/services/watchEvaluator.js` so it no longer references an undefined `lastAlertState`
- Fixed disabled-watch idle results so they do not keep an active latest-event notification
- Expanded `backend/scripts/smoke-check.js` to validate active, stale, and idle watch-result paths
- Re-validated the backend with `npm run check` plus a live boot and `/api/status` and `/api/watches` requests

## 2026-04-21T19:13:12-04:00

- Inspected TornPDA's real import model from the official app source instead of guessing the JSON format
- Added `tornpda-script/tornpda-market-watcher.json` as a TornPDA importable script package
- Preserved the original userscript metadata and embedded the full existing script source in the JSON package
- Updated setup and handoff docs to point at the JSON import flow rather than importing the raw `.user.js`
- Why: TornPDA imports a JSON array of script objects, so the project needed an actual import package for device testing

## 2026-04-21T20:41:17-04:00

- Reworked the backend and TornPDA client around an explicit 6-slot watch model
- Added automatic migration from the old watch-array store format into the new slot-based `version: 2` store
- Added slot-aware endpoints: `/api/slots`, `/api/slot/:slotNumber`, plus add, update, and clear slot operations
- Updated `/api/status` to explain the correct backend base URL input and the available API endpoints
- Replaced the old prompt-based TornPDA backend URL flow with an inline base-URL field, `Connection Test`, and clearer error reporting
- Added add or edit or remove slot controls to the TornPDA UI and kept all 6 slots visible at once
- Verified:
  - userscript syntax check passed
  - backend smoke check passed
  - live `/api/status` and `/api/slots` returned the expected slot-aware payloads
  - isolated API test confirmed add, edit, clear, and 6-slot limit enforcement
- Regenerated `tornpda-script/tornpda-market-watcher.json` from the updated userscript source so the import package matches the latest code

## 2026-04-21T21:04:57-04:00

- Audited LAN accessibility after the user reported that phone-side access to the backend failed even though localhost worked on the PC
- Verified current runtime/network facts:
  - `.env` uses `BACKEND_HOST=0.0.0.0`
  - the active LAN IPv4 should be discovered at runtime instead of hardcoded in repo docs
  - `netstat` showed `0.0.0.0:3000 LISTENING`
- Added backend network diagnostics:
  - new `backend/src/utils/networkDiagnostics.js`
  - richer `/api/status` output with localhost and LAN URL candidates
  - startup logs for localhost and LAN URLs
  - `/health` plain-text route
  - `/` plain-text helper route for quick browser testing
  - cleaner startup failure logging for port-in-use errors
- Updated TornPDA messaging to make it even clearer that the user must enter the base URL only and that the script appends `/api/status` and `/api/slots` internally
- Rewrote README and setup/handoff docs around the real blocker: LAN accessibility, firewall, IP selection, and same-network checks
- Re-generated `tornpda-script/tornpda-market-watcher.json` after the userscript changes

## 2026-04-21T21:31:46-04:00

- Reworked the TornPDA watcher lifecycle so recurring polling no longer auto-starts on script load or page load
- Added explicit `Start Watching` and `Stop Watching` controls plus a visible watcher status card with `INACTIVE`, `WATCHING`, and `ERROR`
- Added watcher-side lifecycle logging for:
  - start
  - stop
  - completed poll cycles
  - skipped cycles when inactive
- Guarded against duplicate polling loops so repeated `Start Watching` presses do not create extra timers
- Kept `Connection Test`, `Save URL`, manual `Refresh`, and slot edits as one-off requests that do not start background polling
- Updated the TornPDA script to prefer TornPDA native HTTP handlers, regenerated the JSON import package, and refreshed README plus setup/status/architecture/decision/handoff docs
- Why: the user wanted manual control over when active market watching begins and ends, and the docs needed to reflect that the backend is already reachable from the phone browser

## 2026-04-21T22:11:39-04:00

- Added backend-side item-name resolution through a bundled item catalog snapshot so slot forms can accept item ID only, item name only, or both
- Updated slot validation and evaluation so `nearMissGap = 0` disables near-miss alerts cleanly
- Reworked alert state handling to use grouped snapshot confirmation before alerting, while keeping notification cooldown separate from the grouping window
- Added backend settings endpoints for runtime alert timing values
- Updated the TornPDA panel with:
  - smarter mobile slot entry
  - alert timing settings UI
  - hide or show panel behavior
  - clearer slot status text for near-miss off and pending grouping
- Added a repository startup cleanup path for the exact legacy one-slot `Torn City Times` demo seed so fresh and upgraded installs land on empty defaults
- Expanded the backend smoke check to cover case-insensitive item-name resolution, grouped alert confirmation, near-miss disabled behavior, and legacy demo-seed cleanup
- Updated README and memory docs to explain empty default slots, item-name resolution, grouped confirmation logic, and the need to restart any already-running old backend process

## 2026-04-21T23:56:29-04:00

- Fixed TornPDA slot mutation reliability by keeping the mobile script on POST-compatible mutation routes and re-fetching canonical `/api/slots` state after every successful slot action
- Added structured backend error responses for slot routes and introduced route-level validation coverage in `backend/scripts/api-check.js`
- Added backend endpoints for one-shot refresh and reset-all flows:
  - `POST /api/refresh`
  - `POST /api/slots/reset`
  - `POST /api/slot/:slotNumber/enabled`
- Updated TornPDA UI and behavior:
  - removed the giant temporary debug log from normal usage
  - added clearer full vs compact mode behavior
  - split refresh behavior into `Refresh Now` vs `Reload Saved Slots`
  - disabled relevant buttons while requests are in flight
  - replaced `Open market` anchors with button-driven navigation
  - kept compact mode showing update timing and per-slot status badges
- Corrected backend market links to Torn's current Item Market route and documented the change
- Strengthened automated validation:
  - `npm run check` now runs both the existing smoke check and the new API check
  - API check confirms slot 2 add, slot 3 add, edit persistence, clear and reuse, reset all, duplicate blocking, invalid slot rejection, and per-slot alert independence
- Updated README, setup notes, current status, architecture, decisions, TODO, and handoff docs for the new slot lifecycle, refresh split, reset-all flow, compact mode, and open-market behavior

## 2026-04-22T00:26:38-04:00

- Hardened the TornPDA add-item and edit-item request flow so the UI should no longer remain stuck on `Saving...`
- Added an explicit timeout around TornPDA native request-handler calls and added cleanup-style request-state resets across save, clear, toggle, reset, connection test, settings save, and manual refresh
- Updated slot save behavior to:
  - apply the returned slot payload locally immediately after backend confirmation
  - close the form before the canonical slot reload finishes
  - show a partial-success message if the follow-up `/api/slots` refresh fails
- Added malformed-response checks for save and slot-reload flows
- Changed the hidden launcher behavior:
  - hidden-state button now shows as `Open Menu`
  - hidden launcher defaults to the left side of the screen
  - added `Move Open Menu Button` mode with arrow nudges and a green save button
  - launcher position now persists through local storage
- Bumped the TornPDA script version to `1.5.1`, regenerated the JSON import package, and updated README plus memory docs to match
