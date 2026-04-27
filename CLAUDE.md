# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Glance** — a hands-free web reader for Even Realities G2 smart glasses. Pick a saved source, see the article list, tap a headline to read the body paginated on the glasses display. Articles are extracted via [`r.jina.ai`](https://jina.ai/reader/) (free public URL-to-markdown service) by default; advanced users deploy a personal Cloudflare Worker (`worker-template/`) for cookie-walled sites OR as a Default Worker that bypasses r.jina.ai entirely (faster, no rate limits).

Differentiator vs the third-party "ER Browser" app on the Hub: Glance ships with curated sources + Inbox + ESPN scoreboard + Resume + 30-day cache, vs ER's "type any URL each time" model.

One of four Even-glasses-app repos at `~/Documents/{Cue,Pulse,Glance,lyrics-glow}`.

## Commands

```bash
npm run dev                   # Vite on :5175 (host 0.0.0.0 for LAN)
npm run build                 # tsc + vite build → dist/
npm run pack                  # lint-app-json + evenhub pack → glance.ehpk
npm run deploy                # build + pack
npm test                      # vitest (439 tests — 17 site-fixtures × ~25 each)
npm run test:e2e              # simulator regression
npm run test:backends         # live integration tests against r.jina.ai + ESPN
node scripts/refresh-fixtures.mjs    # re-capture article fixtures from real sites
node scripts/test-extraction.mjs     # live preview: how each source extracts today
npx evenhub qr --url http://<lan-ip>:5175
```

## Architecture

Two layers:

1. **Plugin (this repo).** Three-layer navigation: sources → article list → reader. `src/main.ts` owns the state machine + phone settings UI; `src/even.ts` wraps the glasses bridge; `src/jina.ts` is the r.jina.ai client; `src/worker-fetch.ts` is the optional Default Worker client (tries first, falls back to jina); `src/extract.ts` parses article links from homepage markdown; `src/paginate.ts` strips page chrome + paginates onto the 576x288 display; `src/storage.ts` owns persistent state (sources, resume position, cache, settings). Adapters in `src/adapters/` (jina, espn-news, inbox, worker) implement source-specific fetch logic.

2. **Worker (in `worker-template/`).** Personal Cloudflare Worker the user deploys for: (a) cookie-walled sites that r.jina.ai can't reach, (b) bypassing r.jina.ai entirely as the Default Worker. Single endpoint `GET /reader?url=<encoded>` with bearer auth, returns `{ok, title, body}` after running `JSDOM` + `@mozilla/readability`.

## Conventions

- **Page chrome is filtered POST-fetch** in `src/paginate.ts strip()`. r.jina.ai's headless extraction keeps nav/footer/ads as real DOM text; we drop them via pattern matching. The filter has 50+ patterns built up from real-world testing on 17 sites. Adding a new site usually surfaces a few new patterns — capture a fixture with `scripts/refresh-fixtures.mjs`, run tests, add patterns until the regression-guard tests pass.
- **`tests/fixtures/<site>.md`** are real captures of `r.jina.ai` responses. Tests run against fixtures (deterministic, no flakes). Refresh ~every 2 months OR after a meaningful filter change.
- **`tests/extraction-fixtures.test.ts`** generates ~16 tests per fixture × 17 fixtures. Each chrome pattern in `REGRESSION_GUARDS` becomes its own test for clear failure messages.
- **Inbox** is a per-user save-for-later list. `src/adapters/inbox.ts` is the storage; phone-side has paste-URL form + clipboard auto-detect banner ("URL on clipboard: …" → "Save to inbox"). v0.5.0 added "Save & open on glasses" — sets a one-shot pendingOpen pointer; glasses bootstrap auto-navigates to that article.
- **Scroll mode** (v0.5.0): page-by-page (~400 char pages, default) or line-by-line (~100 char pages). Persisted; switching mid-article re-paginates from page 0.

## Critical quirks (also see KNOWN_QUIRKS.md)

- **r.jina.ai cold start 15-25s** on unfamiliar sites. We have a friendly error message but no client-side workaround besides the Default Worker.
- **r.jina.ai 451 / 403** = upstream legal block / bot wall (Reuters / Reddit). The Default Worker IS the workaround.
- **Empty-text markdown anchors** `[](url)` survive the link-strip pass (regex requires non-empty link text). Caught + filtered as their own pattern.
- **Bullet-prefixed nav** (`• Home`) needs the bullet stripped before NAV_LINE_WORDS lookup. Same for "N. " number prefix on form prompts.

## Sister repos

`Cue / Pulse / lyrics-glow` share `KNOWN_QUIRKS.md`, `NOTICE`, `scripts/lint-app-json.mjs`. The four apps have divergent state machines; don't propagate `src/` files cross-repo.
