# Project Overview

## What This Project Is

TornPDA Market Watcher is now a three-part personal tool for watching Torn item prices:

1. A local Node.js backend
2. A TornPDA userscript frontend
3. A browser-based Desktop Viewer v1

The backend is the source of truth for slot configuration, polling results, alert logic, and processed listing state. TornPDA remains the mobile control layer, and the desktop viewer is an additional read-heavy monitoring client for the same backend.

## Main User Outcome

The user can keep up to 6 watched items, choose whether each slot tracks:

- `Market Only`
- `Bazaar Only`

and get clear mobile-friendly status plus immediate low-price alerts without duplicate spam for the same still-active listing.

The same canonical backend state can now also be viewed on a desktop dashboard that shows all 6 slots, current source-specific listings, active alerts, and timing status without relying on TornPDA screen space.

## Final Core Capabilities

- 6 persistent slots
- add, edit, delete, enable, disable, reset
- strict per-slot source mode
- current-snapshot-only alerting
- active low-listing memory
- duplicate suppression while the same listing remains present
- immediate first-seen qualifying alerts
- manual listing panels
- startup-closed mobile UI
- last-known-good UI restore
- version compatibility warnings
- backup export or import
- lightweight recent activity history
- Desktop Viewer v1 dashboard with:
  - 6 always-visible slots
  - selected-slot detail panel
  - Bazaar and Market listing tables
  - top status and timing bar
  - current active alerts panel

## Important Design Rule

Backend state is canonical.

Local TornPDA persistence is only for smoother UX:

- backend URL
- compact or manage mode
- notification preference
- last-known-good slot payload cache

It must not replace good backend data with empty local state.

The desktop viewer follows the same rule. It is a consumer of backend state, not a second source of truth.

## Current Versions

- Backend: `1.8.1`
- Script: `1.8.5`

## Current Next Milestone

Desktop Viewer v1 is now in place as the next client layer. The next likely expansion areas are:

- real browser-side usability validation on the desktop viewer
- desktop notifications if wanted later
- lightweight price history
- future auto-update delivery on top of the existing version-compatibility layer
