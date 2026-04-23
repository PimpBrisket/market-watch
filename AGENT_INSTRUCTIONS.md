# Agent Instructions

## Purpose

This file is the repository-local quick-start for future agents working on TornPDA Market Watcher.

## Before Doing Any Work

Read these files in order:

1. `memory/PROJECT_OVERVIEW.md`
2. `memory/CURRENT_STATUS.md`
3. `memory/ARCHITECTURE.md`
4. `memory/DECISIONS.md`
5. `memory/TODO.md`
6. `memory/HANDOFF.md`
7. `memory/SETUP_NOTES.md`

Do not assume chat history exists.

## Source Of Truth

- The current repository state plus the `memory/` files are the source of truth.
- If memory docs and code disagree, resolve the mismatch and update the memory docs.
- Do not leave memory files vague.

## Scope Rule

Heavy market logic belongs in the backend.

- Backend responsibilities:
  - Weav3r fetches
  - parsing
  - evaluation
  - alert transitions
  - persistence
  - API formatting

- TornPDA responsibilities:
  - poll the backend
  - render watch state
  - show local alerts

## Memory Maintenance Rules

After meaningful changes, always update:

- `memory/CURRENT_STATUS.md`
- `memory/HANDOFF.md`
- `memory/CHANGELOG_AGENT.md`

If architecture changes, also update:

- `memory/ARCHITECTURE.md`
- `memory/DECISIONS.md`

If setup changes, also update:

- `memory/SETUP_NOTES.md`

If unfinished work remains, document it clearly in:

- `memory/TODO.md`
- `memory/HANDOFF.md`

## Definition Of Done

A task is not done unless:

1. the relevant code or docs are updated
2. the relevant memory files are updated
3. the next agent can continue without needing chat history

## Current Recommended Next Action

Before adding more features, run a real TornPDA mobile/LAN validation pass:

1. Start the backend
2. Point TornPDA to the backend LAN URL
3. Confirm panel rendering, refresh, alert behavior, and market deep links

## Important Known Unknowns

- TornPDA mobile behavior is not yet field-verified
- Torn market deep-link route may still need correction
- Weav3r may be returning only part of the listing set even when `total_listings` is larger

## Writing Standard

- Prefer concrete notes over generic summaries
- Record exact files changed
- Record exact next steps
- Record assumptions and unresolved risks

