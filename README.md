# Glance

> **Read the web. No phone.**

Read articles from your saved websites on Even Realities G2 smart glasses, hands-free.

App icon: `assets/icon.svg` (master) and `assets/icon.png` (1024×1024 export). Brand yellow #FEF991 on Even-dark-theme background, three reading lines + glasses silhouette.

Three-layer navigation: pick a saved site → see its current article list → tap a headline to read the body, paginated. Most extraction happens via [`r.jina.ai`](https://jina.ai/reader/) (free public URL-to-markdown service). Adapter pattern lets specific sites use better paths — ESPN uses its public news API to bypass the bot wall.

## Status: v0.5.0 (default Worker, Browse-now, line-by-line scroll)

v0.5.0 differentiates against the third-party "ER Browser" app (~3K downloads on the
Hub) on three axes:

- **Default Worker**: paste your Cloudflare Worker URL + bearer token in phone
  settings → all article-body fetches try your Worker first (server-side Mozilla
  Readability) and fall back to r.jina.ai only on failure. Eliminates r.jina.ai's
  15–25s cold starts and rate limits. The Worker template at `worker-template/`
  is unchanged — same `/reader` endpoint also used for paywalled sites.
- **Save & open on glasses**: phone-side button on the inbox-add form sets a
  one-shot pointer; glasses bootstrap + foreground handler navigates straight
  into the article. Closes the gap with ER Browser's one-step "type URL → read"
  flow.
- **Line-by-line scroll mode**: phone-side toggle. Each swipe advances ~100
  chars instead of ~400, for closer-to-continuous reading. Preserves resume
  position; switching mode re-paginates the current article.

Glance's existing differentiators (curated sources, ESPN scoreboard, Inbox,
30-day cache, paywalled-site Worker, clipboard auto-detect with banner) remain
the install-decision wedge versus ER Browser's "type any URL each time" model.

Sideload to your glasses to test:

```
~/Documents/Glance/glance.ehpk
```

Upload at `https://hub.evenrealities.com/application` to your `com.philtullai.glance` project (you may need to create it first).

## How it works

When you open Glance on the glasses you're at the **Sources** view — a list of your saved websites. Default sources baked in on first launch:

| Source | Adapter | Notes |
|---|---|---|
| ★ Saved articles | `inbox` | Holds URLs you save manually from the phone-side UI (paste / share-sheet workflow) |
| Hacker News | `jina` | Aggregator — articles point to external sites |
| CNN | `jina` | |
| ESPN — NFL | `espn-news` | Uses ESPN's public news API directly to bypass r.jina.ai bot-wall. League is configurable per source |
| BBC News | `jina` | |
| Yahoo News | `jina` | (`news.yahoo.com` works; bare `yahoo.com` is blocked by Jina) |

Tap a source → app fetches that homepage via r.jina.ai, parses the markdown for article-shaped links (filters nav/footer/asset cruft), and shows you the article picker.

Tap a headline → app fetches that article via r.jina.ai, extracts clean text, paginates to ~400-char pages, displays page 1.

Swipe down / single-tap = next page. Swipe up = previous page. Double-tap = back a layer (reader → article list → sources). On the sources view, double-tap exits the app.

## Glasses gestures

| Gesture | Action |
|---|---|
| Single tap on sources view | Open the source picker |
| Single tap on articles view | Open the article picker (also shows full list when more than 6 fit) |
| Single tap on reader view | Next page |
| Swipe down (reader) | Next page |
| Swipe up (reader) | Previous page |
| Double tap (anywhere except sources view) | Back one layer |
| Double tap (sources view) | Exit app |

## Phone-side settings

When you tap the Glance tile in the Even Hub companion app **before** putting on the glasses, you see the settings page:

**Save an article (Inbox):**
- Paste an article URL into the form, optionally with a title, and tap "Save to inbox" — appears under "★ Saved articles" on the glasses immediately
- Tap "Paste from clipboard" to grab whatever URL you just copied (e.g. from Safari's share sheet → "Copy")
- Inbox holds up to 100 articles, oldest evicted

**Manage sources:**
- Add a source (title + homepage URL — uses the jina adapter automatically)
- Remove existing sources (× button)
- Reset to default sources (replaces with the curated 6)

Sources and inbox both persist across launches via the SDK's native `setLocalStorage`.

## Adapters

Glance has three:

- **`jina`** (default) — fetches the homepage via r.jina.ai, extracts article-shaped links from the markdown. Works for most static + JS-rendered sites.
- **`espn-news`** — fetches `site.api.espn.com/apis/site/v2/sports/{league}/news` directly. Bypasses ESPN's r.jina.ai bot-wall. Body is the API's `description` field (summary only — ESPN's full-text API is private). Configurable via `adapterConfig.league` (e.g. `football/nfl`, `basketball/nba`, `hockey/nhl`).
- **`inbox`** — synthetic source that lists articles saved via the phone-side UI. Article bodies fetched on-demand via the jina adapter.

Adapters are registered in `src/adapters/index.ts`. Adding a new one means: write a module exporting an `Adapter`, add it to the registry, optionally seed a default source using it.

## Article cache

- Article list per source: cached 5 minutes in memory (re-fetches on stale)
- Article body: cached 30 days on disk via native storage, 100-article LRU cap
- Re-reading a previously-read article costs zero r.jina.ai requests

## Resume position

When you close Glance mid-article, your `{source, article, page}` is persisted. Next launch resumes you at the same page.

## Known limitations in v1

| Limitation | Workaround |
|---|---|
| **ESPN** bot-walls r.jina.ai for the public site, and so do CBS Sports + bare yahoo.com. Adding `https://espn.com` as a generic source returns 0 articles | Use the bundled "ESPN — NFL" default source (uses ESPN's API via the `espn-news` adapter — works perfectly). Other leagues: change `adapterConfig.league` to `basketball/nba`, `hockey/nhl`, `baseball/mlb`, etc. |
| **Paywalled articles** show only the teaser, with a "behind a paywall" warning | Open the URL in your phone browser to read the full article |
| **r.jina.ai free tier**: ~200 requests / IP / day | Aggressive caching keeps power users well under the cap. v2 may add an optional Jina API key field for unlimited use |
| **Some sites have anti-bot walls even via r.jina.ai** | Detected and shown as "this site blocks automated access". Try a different source |
| **JS-only sites with bot detection (e.g. Twitter/X, Reddit-modern)** | Probably won't work. r.jina.ai handles JS but some bot-detection layers see through |

## Development

```bash
npm install
npm run dev     # Vite dev server on :5175
npm run build   # tsc + vite build → dist/
npm run pack    # evenhub pack → glance.ehpk
npm run deploy  # build + pack in one step
npm test        # run Vitest unit + integration tests
npm run test:watch   # Vitest in watch mode while editing
```

Test fixtures captured from real `r.jina.ai` responses live under `tests/fixtures/`. Tests cover article extraction (HN cross-domain, CNN/BBC same-site, blocklist filtering, dedupe, relative URL resolution, mailto/javascript rejection), pagination (paragraph/sentence/word boundaries, markdown stripping, content preservation), paywall + bot-wall classification, URL validation, and default-source invariants.

The dev server runs on port 5175 to avoid colliding with Pulse (5174) or Vite default (5173).

### Test on real glasses without packing

```bash
npx evenhub qr --url http://<your-mac-lan-ip>:5175
```

Scan the QR code from the Even Hub companion app — your glasses load directly from the dev server, with hot reload.

### Test in the simulator

```bash
npx evenhub-simulator --glow --automation-port 9898 http://localhost:5175
```

## Architecture

```
┌──────────────────────────────────────────────────────┐
│ Even Hub companion app (iOS / Android)               │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Glance plugin (TypeScript, this repo)            │ │
│ │  - phone-side settings UI (visible in companion) │ │
│ │  - reader engine (extract + paginate)            │ │
│ │  - bridge.setLocalStorage for sources + cache    │ │
│ └──────────────────┬───────────────────────────────┘ │
└────────────────────┼─────────────────────────────────┘
                     │ fetch()
                     ▼
        ┌────────────────────────────┐
        │  https://r.jina.ai/<url>   │
        │  (free, CORS-open,         │
        │   headless Chromium)       │
        └────────────────────────────┘
                     │
                     ▼
              ┌──────────────┐
              │ G2 glasses   │
              │ via BLE      │
              └──────────────┘
```

No bridge service, no Mac dependency, no Tailscale. The whole stack is plugin code + r.jina.ai.

## Source files

| File | Purpose |
|---|---|
| `src/main.ts` | Entry, three-layer navigation state machine, phone-side settings UI (sources + inbox forms) |
| `src/even.ts` | Glasses bridge wrapper — text container + modal picker + input routing |
| `src/adapters/index.ts` | Adapter registry + `Adapter` interface + `getAdapter(source)` |
| `src/adapters/jina.ts` | Default adapter — uses r.jina.ai for both homepage extraction and article body |
| `src/adapters/espn.ts` | ESPN adapter — uses `site.api.espn.com` news endpoint to bypass the bot wall |
| `src/adapters/inbox.ts` | Inbox adapter — lists saved-URL articles from local storage |
| `src/jina.ts` | r.jina.ai HTTP client + paywall/bot-wall classifier |
| `src/extract.ts` | Markdown link → article-shaped item extractor |
| `src/paginate.ts` | ~400-char text pagination on word boundaries |
| `src/storage.ts` | Native `setLocalStorage` wrapper + browser fallback |
| `src/sources.ts` | Default source list + URL validation |
| `src/types.ts` | Shared interfaces (`Source`, `Article`, `AdapterKind`, etc.) |
| `tests/*.test.ts` | Vitest unit + integration tests |
| `tests/fixtures/*.txt` | Captured r.jina.ai responses for repeatable testing |

## Roadmap

See `~/Documents/Pulse/ROADMAP.md` § "Plan: Glasses Web Reader" for the full spec.

**Queued for v1.x / v2:**
- ESPN-specific API adapter (uses `site.api.espn.com` to bypass the bot wall)
- Authenticated sites (e.g. `bwi.rivals.com`) via a personal Cloudflare Worker proxy
- Optional Jina API key field for unlimited rate
- iOS Share Sheet integration for "send any URL to Glance" without manual paste
- Pocket / Readwise OAuth import
