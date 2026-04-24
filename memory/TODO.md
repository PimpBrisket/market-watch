# TODO

## Highest Priority Next

- Run one real TornPDA phone-side validation pass using script version `1.8.3`
- Confirm:
  - `Open market` lands correctly
  - `Open Bazaar` lands correctly
  - compact mode still feels clean on the device
  - notification permission behavior is understandable on the device

- Run one real desktop browser-side validation pass for Desktop Viewer v1
- Confirm:
  - `/viewer` layout feels right on the target monitor size
  - slot selection is comfortable with real data
  - Bazaar `Open Bazaar` actions behave as expected
  - stale or disconnected states are readable at a glance

## GitHub Follow-Up

- initialize or connect the final git remote if not already done
- confirm ignored files are not staged:
  - `.env`
  - `backend/data/store.json`
  - `node_modules`
  - logs

## Auto-Update Follow-Up

- decide how script auto-update should be delivered
- decide whether backend update checks should be manual, documented, or automated
- add a release note process for version bumps

## Nice-To-Have Later

- optional file-based import in addition to paste-based import
- richer device notification controls
- desktop notifications once the viewer foundation is stable
- lightweight price history in the desktop detail panel
- richer desktop analytics after the monitoring layout settles
- deeper paginated Bazaar listing support if upstream access is worth the extra complexity
- optional auth or shared secret for LAN-only deployments
- SQLite storage option if history needs become larger
