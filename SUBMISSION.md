# Hub Submission Packet — Glance v0.3.0

Everything you need to copy-paste into the Even Hub developer portal at `https://hub.evenrealities.com/application` when submitting Glance for the first time. Update this file each time you submit a meaningful new version.

---

## App identity

- **Name**: Glance *(matches `app.json` `name` field, must be ≤ 20 chars)*
- **Package ID**: `com.philtullai.glance`
- **Version**: 0.3.0 *(use the value in `app.json`; update before each submission)*
- **Tagline**: **Read the web. No phone.**

## Long description

Paste this verbatim if the portal has a single-paragraph description field:

> Glance turns your Even G2 glasses into a hands-free reader. Open it from the launcher, pick a saved website, and scroll through its current articles right there in your line of sight. Tap a headline to read the body — paginated to ~400 characters per page, swipe to flip. No phone needed once you're configured. Built-in sources include Hacker News, CNN, ESPN, BBC News, and Yahoo News, plus a "Saved articles" inbox for any URL you paste in from another app. Articles cache for 30 days so re-reading costs nothing.

If the portal has a multi-paragraph description, use this expanded version:

> **Glance turns your Even G2 glasses into a hands-free reader.** Open it from the launcher, pick a saved website, and scroll through its current articles right there in your line of sight. Tap a headline to read the body — paginated to ~400 characters per page, swipe to flip pages.
>
> **Three layers, all driven by the cursor.** Swipe up/down moves a `>` cursor through your sources, then through the article list. Tap to commit. Double-tap to back out a layer. No phone interactions needed once you've added your sources.
>
> **Bring your own sources.** Glance ships with five working defaults: Hacker News, CNN, ESPN — NFL, BBC News, and Yahoo News. Add any other site from the phone-side settings page. The app uses a free public service (`r.jina.ai`) to extract clean article text from arbitrary URLs — handles JavaScript-rendered sites that defeat simpler scrapers.
>
> **Save anything to read later.** A built-in "Saved articles" inbox holds URLs you paste in from any app's share sheet. Open Glance settings on your phone, paste a URL, and it appears at the top of your sources on the glasses next time you wear them.
>
> **What it can't do:** sites with paywalls (we show the teaser plus a "open in browser" hint), sites that block the underlying extraction service (a clear error message points you to a different source), and authenticated sites like NYT-with-account or paid forums. Roadmap items.

## What's new in v0.3.0

> Cursor-scroll list navigation — swipe to highlight, tap to open. State migration for v0.1.0 / v0.2.0 installs that didn't have the Inbox or ESPN adapter. Friendly error messages when the extraction service rate-limits.

## Visual assets

All under `assets/` in the repo root. Copy the PNGs to wherever the Hub portal accepts uploads.

| Asset | Path | Use for |
|---|---|---|
| App icon | `assets/icon.png` (1024×1024 PNG) | Hub catalog tile + launcher icon |
| Icon source | `assets/icon.svg` (vector master) | Re-render at other sizes if needed |
| Sources screenshot | `assets/screenshots/01-sources.png` | "Pick a saved site" — first impression |
| Articles screenshot | `assets/screenshots/02-articles.png` | "Browse current articles" — second view |
| Reader screenshot | `assets/screenshots/03-reader.png` | "Read the body, paginated" — third view |
| Reader mid-article | `assets/screenshots/04-reader-mid.png` | Optional — shows real content paginated |
| Sources scrolled | `assets/screenshots/05-sources-scrolled.png` | Optional — demonstrates the cursor scrolling through a list |

If the Hub portal asks for **3 screenshots**, use 01, 02, 03 in that order — they walk through the user's primary path. Add 04 and 05 if it accepts more.

## Suggested category / keywords

The Hub portal categorization isn't documented in the CLI, so I don't know the exact taxonomy — fill in based on what the form offers. Best guesses:

- **Category**: News & Reading, or Productivity, or Reference
- **Keywords**: reader, articles, RSS, news, hands-free, blog, longform, reading, Hacker News, content
- **Language**: English (the only language Glance ships in for v0.3.0)

## Privacy / data handling notes

If the portal requires a privacy disclosure, this is honest:

> **What Glance accesses:** the URLs of websites you've saved as sources, and the article URLs you tap to read. These are sent to `r.jina.ai` (Jina AI's public reader service) for extraction, and to `site.api.espn.com` for the ESPN adapter. The app does NOT collect telemetry, doesn't track which articles you read, and doesn't share any data with the developer.
>
> **What persists locally:** your saved sources, your inbox of saved article URLs, and a 30-day cache of recently-read article bodies. All stored in the Even Hub companion app's local storage on your phone — never uploaded.
>
> **Permissions:** outbound network access only, scoped via `app.json` whitelist to `r.jina.ai` and `site.api.espn.com`. No microphone, location, camera, or photo access.

## Test credentials / demo notes

> No login required. Glance ships with five working default sources; first launch is fully usable without configuration. To add a personal source, paste the homepage URL into the phone-side settings page.

## Known limitations

- **r.jina.ai rate limit**: the free tier blocks at ~200 requests / IP / day, often per-domain rolling blocks (~few hours). When this happens, Glance shows "Rate-limited by Jina — try again in a few hours" and the cached articles still work.
- **Paywalled articles**: surface the teaser with a "behind a paywall" warning. Open in your phone browser to read full.
- **JS-rendered sites with bot detection**: most sites work; some (notably the bare ESPN.com) block the extraction service entirely. ESPN is supported via a separate API adapter as a workaround.
- **No microphone, no voice commands**: text-only navigation in v1.

## Submission checklist

Before clicking submit:

- [ ] `app.json` `version` matches the value in this doc
- [ ] `glance.ehpk` rebuilt with the latest commit (`npm run pack`)
- [ ] Tests pass (`npm test`)
- [ ] Type-check passes (`npx tsc --noEmit`)
- [ ] Tagline + description copy-paste-ready
- [ ] Icon and 3+ screenshots ready in `assets/`
- [ ] Whitelist in `app.json` covers every host the app actually fetches (currently: `r.jina.ai`, `site.api.espn.com`)
- [ ] No secrets in any committed file
