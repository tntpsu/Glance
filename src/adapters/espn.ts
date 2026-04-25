// ESPN adapter — uses ESPN's public news API directly. Bypasses the
// r.jina.ai bot-wall (ESPN's www.espn.com / .com / cbssports.com all
// 451-block r.jina.ai's headless Chromium). The /apis/site/v2 endpoint
// has no such protection and is intended for third-party use.
//
// Body fetch limitation: ESPN's news endpoint returns only `description`
// (a 1-2 sentence summary), not the full article body. Their full-text
// API is private. Our adapter surfaces the description as the body with
// a note + the espn.com URL so the user can finish reading on their
// phone.

import type { Adapter, ArticleBody } from './index'
import type { Article, Source } from '../types'

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/'
const FETCH_TIMEOUT_MS = 8_000

// Curated ESPN leagues — surfaced in the phone-side source editor as a
// dropdown. Slug must match ESPN's API path under /apis/site/v2/sports/.
export const ESPN_LEAGUES: Array<{ slug: string; label: string }> = [
  { slug: 'football/nfl', label: 'NFL' },
  { slug: 'basketball/nba', label: 'NBA' },
  { slug: 'hockey/nhl', label: 'NHL' },
  { slug: 'baseball/mlb', label: 'MLB' },
  { slug: 'football/college-football', label: 'College Football' },
  { slug: 'basketball/mens-college-basketball', label: 'Men\'s College Basketball' },
  { slug: 'basketball/womens-college-basketball', label: 'Women\'s College Basketball' },
  { slug: 'soccer/eng.1', label: 'Premier League' },
  { slug: 'soccer/usa.1', label: 'MLS' },
  { slug: 'racing/f1', label: 'Formula 1' },
  { slug: 'tennis/atp', label: 'Tennis (ATP)' },
  { slug: 'golf/pga', label: 'PGA Tour' },
]

interface EspnApiResponse {
  articles?: Array<{
    headline?: string
    description?: string
    published?: string
    links?: { web?: { href?: string } }
  }>
}

function leagueOf(source: Source): string {
  return source.adapterConfig?.league ?? 'football/nfl'
}

export const espnAdapter: Adapter = {
  async fetchHomepage(source: Source): Promise<Article[]> {
    const league = leagueOf(source)
    const url = `${ESPN_API_BASE}${league}/news?limit=20`
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      })
      if (!resp.ok) throw new Error(`ESPN API HTTP ${resp.status}`)
      const data = (await resp.json()) as EspnApiResponse
      const articles = data.articles ?? []
      return articles
        .filter(a => !!a.headline)
        .map<Article>(a => ({
          title: a.headline ?? '',
          url: a.links?.web?.href ?? `espn://no-link/${encodeURIComponent(a.headline ?? '')}`,
          summary: a.description?.trim(),
          published: a.published,
        }))
    } finally {
      window.clearTimeout(timer)
    }
  },

  async fetchArticleBody(_source: Source, article: Article): Promise<ArticleBody> {
    // ESPN doesn't give us a full body — surface the summary + a URL so
    // the user can finish on their phone. This is intentional and
    // documented: ESPN article bodies require a private API.
    const summary = article.summary?.trim() || '(no summary available)'
    const dateLine = article.published
      ? `\n\nPublished: ${article.published.slice(0, 10)}`
      : ''
    const linkLine = article.url.startsWith('http')
      ? `\n\nFull article: ${article.url}`
      : ''
    const body = `${summary}\n\n— ESPN summary only — open URL on phone for full article.${dateLine}${linkLine}`
    return { title: article.title, body }
  },

  homepageUrlForDisplay(source: Source): string {
    return `ESPN ${leagueOf(source)} via API`
  },
}
