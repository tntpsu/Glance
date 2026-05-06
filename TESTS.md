# TESTS — coverage matrix (Glance v0.4.0)

Last updated: 2026-05-05 (seeded from coverage-matrix skill).

Full taxonomy + discipline: `~/.claude/skills/coverage-matrix/SKILL.md`. Empty cells block the next ship. `/ship-app` blocks if this file has unfilled cells.

## Use case × failure mode

| Use case | Happy | Bad URL | r.jina.ai down | Worker auth fail | Stale cache | Auth-walled site |
|---|---|---|---|---|---|---|
| Sources picker → article list | e2e | n/a | manual:hw | n/a | manual:hw | n/a |
| Tap source → fetch homepage | e2e | unit:extract | manual:hw | n/a | manual:hw | manual:hw |
| Tap article → fetch body | e2e | unit:extract | manual:hw | n/a | manual:hw | manual:hw |
| Paginated text reading | e2e | n/a | n/a | n/a | n/a | n/a |
| Swipe-end → next article | e2e | n/a | n/a | n/a | n/a | n/a |
| Double-tap = back navigation | e2e | n/a | n/a | n/a | n/a | n/a |
| ESPN news adapter | unit:adapters | unit:adapters | manual:hw | n/a | n/a | n/a |
| ESPN league picker | manual:DOM | unit:source | n/a | n/a | n/a | n/a |
| Inbox / share-sheet paste | manual:DOM | unit:paginate | n/a | n/a | n/a | n/a |
| Clipboard auto-import on focus | manual:DOM | n/a | n/a | n/a | n/a | n/a |
| Read-state tracking (✓ markers) | unit:read-state TODO | n/a | n/a | n/a | manual | n/a |
| Worker adapter for auth-walled site | manual:hw | n/a | manual:hw | manual:hw | manual:hw | manual:hw |
| Glasses display rendered | e2e screenshot | n/a | n/a | n/a | n/a | n/a |

## By dimension (status)

- **Static:** lint+tsc ✓, app-json validation ✓, network whitelist matches code TODO
- **Unit:** 36 tests across `src/` modules
- **E2E:** `scripts/regression.mjs` — 10/10 passing (state log, swipe, double-tap)
- **Backend integration:** `scripts/test-backends.mjs` (against r.jina.ai + ESPN APIs), `scripts/test-extraction.mjs` (markdown extraction)
- **Performance:** no enforced budgets — TODO bundle size budget, fetch latency p95
- **Security:** Worker template handles auth-walled sites; no secrets in source ✓
- **Privacy:** read state stored locally per source ✓
- **Compatibility:** WKWebView-tested via shared `test-webkit` pattern (with Cue)
- **Regression:** chunked-POST pattern, ESPN news adapter (was: scoreboard adapter)

## Outstanding gaps before v0.5 ship

- [ ] Worker adapter integration test (mocked auth flow)
- [ ] iOS Shortcut share-sheet flow (manual)
- [ ] Pocket / Readwise OAuth import (planned)
- [ ] Read-state filter ("show unread only") test
- [ ] Network whitelist consistency check
