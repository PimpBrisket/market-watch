# Project Overview

## What This Project Is

TornPDA Market Watcher is a two-part personal tool for watching Torn item prices:

1. A local Node.js backend
2. A TornPDA userscript frontend

The backend is the source of truth for slot configuration, polling results, alert logic, and processed listing state. The TornPDA script is the mobile control and display layer.

## Main User Outcome

The user can keep up to 6 watched items, choose whether each slot tracks:

- `Market Only`
- `Bazaar Only`

and get clear mobile-friendly status plus immediate low-price alerts without duplicate spam for the same still-active listing.

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

## Important Design Rule

Backend state is canonical.

Local TornPDA persistence is only for smoother UX:

- backend URL
- compact or manage mode
- notification preference
- last-known-good slot payload cache

It must not replace good backend data with empty local state.

## Current Versions

- Backend: `1.8.1`
- Script: `1.8.1`

## Current Next Milestone

The project is now ready for GitHub cleanup and future automatic update work. The next meaningful step after publishing is a real on-device TornPDA validation pass and then implementing the update delivery path on top of the new version-compatibility layer.
