# Glance

Read articles from your saved websites on Even Realities G2 smart glasses, hands-free.

Three-layer navigation: pick a saved site → see its current article list → tap a headline to read the body, paginated. All extraction happens via [`r.jina.ai`](https://jina.ai/reader/) — a free public service that turns any URL into clean markdown via headless Chromium. No backend infrastructure required.

## Status: v0.1.0 (initial sideload-able build)

The full app is built. Sideload to your glasses to test:

```
~/Documents/Glance/glance.ehpk
```

Upload at `https://hub.evenrealities.com/application` to your `com.philtullai.glance` project (you may need to create it first).

## How it works

When you open Glance on the glasses you're at the **Sources** view — a list of your saved websites. Default sources baked in on first launch:

- Hacker News (`news.ycombinator.com`)
- CNN (`cnn.com`)
- Yahoo News (`news.yahoo.com`)
- BBC News (`bbc.com/news`)
- Yahoo Sports (`sports.yahoo.com`)

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

- Add a source (title + URL)
- Remove existing sources (× button)
- Reset to default sources

Sources persist across launches via the SDK's native `setLocalStorage`.

## Article cache

- Article list per source: cached 5 minutes in memory (re-fetches on stale)
- Article body: cached 30 days on disk via native storage, 100-article LRU cap
- Re-reading a previously-read article costs zero r.jina.ai requests

## Resume position

When you close Glance mid-article, your `{source, article, page}` is persisted. Next launch resumes you at the same page.

## Known limitations in v1

| Limitation | Workaround |
|---|---|
| **ESPN** bot-walls r.jina.ai (and CBS Sports, bare yahoo.com). Adding `https://espn.com` as a source returns 0 articles | Use `sports.yahoo.com` for sports (default), or wait for v1.5's planned ESPN-API adapter (uses `site.api.espn.com` directly) |
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
```

The dev server runs on port 5175 to avoid colliding with Phils Home (5174) or Vite default (5173).

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
| `src/main.ts` | Entry, three-layer navigation state machine, phone-side settings UI |
| `src/even.ts` | Glasses bridge wrapper — text container + modal picker + input routing |
| `src/jina.ts` | r.jina.ai client + paywall/bot-wall classifier |
| `src/extract.ts` | Markdown link → article-shaped item extractor |
| `src/paginate.ts` | ~400-char text pagination on word boundaries |
| `src/storage.ts` | Native `setLocalStorage` wrapper + browser fallback for dev preview |
| `src/sources.ts` | Default source list + URL validation |
| `src/types.ts` | Shared interfaces |

## Roadmap

See `~/Documents/PhilsHome/ROADMAP.md` § "Plan: Glasses Web Reader" for the full spec.

**Queued for v1.x / v2:**
- ESPN-specific API adapter (uses `site.api.espn.com` to bypass the bot wall)
- Authenticated sites (e.g. `bwi.rivals.com`) via a personal Cloudflare Worker proxy
- Optional Jina API key field for unlimited rate
- iOS Share Sheet integration for "send any URL to Glance" without manual paste
- Pocket / Readwise OAuth import
