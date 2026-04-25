// Curated default sources for first-launch.
//
// What we ship: 5 sources that all reliably work via r.jina.ai (verified
// during scaffolding). Sites that bot-wall r.jina.ai (notably ESPN and
// the bare yahoo.com / cbssports.com domains) are NOT included — they'd
// silently return zero articles and look broken. Subdomains that work
// (sports.yahoo.com, news.yahoo.com) substitute. ESPN-specific support
// is queued for v1.5 via a dedicated API adapter using
// `site.api.espn.com`, since their public news API doesn't have the bot
// wall.

import type { Source } from './types'

let nextId = 1
function id(): string {
  // Module-load counter is fine — reset on each install. We only need
  // uniqueness within this run; saved sources have stable persisted IDs.
  return `src_${Date.now()}_${nextId++}`
}

export const DEFAULT_SOURCES: Source[] = [
  // Inbox is always first — saved articles and any incoming share-sheet URLs
  // land here. Synthetic URL since the inbox adapter doesn't fetch a homepage.
  { id: id(), title: '★ Saved articles', url: 'inbox://saved', adapter: 'inbox' },
  { id: id(), title: 'Hacker News', url: 'https://news.ycombinator.com' },
  { id: id(), title: 'CNN', url: 'https://www.cnn.com' },
  // ESPN now uses the public news API directly — bypasses the bot wall
  // that blocks r.jina.ai. League is configurable per source.
  {
    id: id(),
    title: 'ESPN — NFL',
    url: 'espn-news://football/nfl',
    adapter: 'espn-news',
    adapterConfig: { league: 'football/nfl' },
  },
  { id: id(), title: 'BBC News', url: 'https://www.bbc.com/news' },
  { id: id(), title: 'Yahoo News', url: 'https://news.yahoo.com' },
]

export function makeSource(title: string, url: string): Source {
  return { id: id(), title: title.trim(), url: url.trim() }
}

// Crude URL validation — just enough to reject obvious typos. We're
// permissive about scheme: http or https accepted, no auth segments.
// Hostname must contain a dot (so "example.com") or be localhost — Node's
// URL parser accepts "https:///path" with hostname="path" otherwise.
export function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    if (!u.hostname) return false
    if (u.hostname === 'localhost') return true
    return u.hostname.includes('.')
  } catch {
    return false
  }
}
