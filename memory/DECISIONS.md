# Decisions

## 2026-04-20: Keep The Backend As The Brains

Decision:

- market parsing
- alert evaluation
- persistence
- duplicate suppression

stay in the backend, not in TornPDA.

Why:

- one canonical logic path
- easier future clients
- less mobile fragility

## 2026-04-21: Use A Fixed 6-Slot Model

Decision:

- keep 6 explicit slots instead of a loose watch list

Why:

- matches the user’s mental model
- empty slots stay visible
- slot replacement behavior stays predictable

## 2026-04-22: Split Tracking Into Strict `Market Only` And `Bazaar Only`

Decision:

- every occupied slot has one active source mode only

Why:

- avoids mixed-source confusion
- keeps alert memory and duplicate suppression understandable
- lets the UI describe the current source clearly

## 2026-04-22: Alert Only From Real Current Listings

Decision:

- only alert from listings present in the current processed snapshot

Why:

- prevents stale ghost alerts
- stops historical merged state from pretending a listing is still live

## 2026-04-22: Use Active Low-Listing Memory

Decision:

- remember qualifying active listings while they remain present
- remove them when a later snapshot confirms they are gone

Why:

- immediate alert on first sighting
- no duplicate spam while still present
- clean re-alert behavior if a listing disappears and a new one appears later

## 2026-04-23: Fresh Loads Always Start Closed

Decision:

- do not auto-open the watcher on a fresh page load

Why:

- the user wants a predictable closed startup
- reduces surprise work and unnecessary sync behavior

## 2026-04-23: Listing Panels Are Manual

Decision:

- Bazaar and Market listing panels stay collapsed until explicitly opened

Why:

- cleaner mobile UI
- less clutter in compact mode
- easier to scan slot cards quickly

## 2026-04-23: Add Explicit Version Compatibility Checks

Decision:

- script defines a minimum backend version
- backend exposes a minimum compatible script version
- incompatible versions show a clear warning and disable risky actions

Why:

- required groundwork for future auto-update support
- safer than partial silent breakage

## 2026-04-23: Keep Backup Format Human-Readable JSON

Decision:

- backup export and import use a readable JSON object with backend and UI sections

Why:

- easy manual inspection
- safer debugging
- simpler future migration support

## 2026-04-23: Add A Small Activity Log Instead Of A Debug Wall

Decision:

- keep a recent bounded activity log for meaningful operator events

Why:

- helps explain what changed
- avoids a noisy developer-style debug panel in the normal UI
