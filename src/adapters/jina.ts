// Default adapter: fetches a source's homepage via r.jina.ai, extracts
// article-shaped links from the returned markdown, and fetches article
// bodies on-demand.
//
// v0.5.0: when the user has configured a default Worker (phone settings →
// "Use my Worker as the default extractor"), article-body fetches try
// the Worker first and fall back to r.jina.ai on any failure. The Worker
// runs Mozilla Readability server-side and returns clean text faster than
// r.jina.ai's cold-start (15-25s on unfamiliar sites). r.jina.ai stays
// the default for users who haven't deployed the Worker.

import { extractArticles } from '../extract'
import { dedupedFetch } from '../inflight'
import { classifyBody, fetchViaJina } from '../jina'
import { getDefaultWorker } from '../storage'
import { fetchViaWorker } from '../worker-fetch'
import type { Adapter, ArticleBody } from './index'
import type { Article, Source } from '../types'

// v0.5.6: in-flight dedupe map. Two rapid taps on the same article
// would otherwise miss-cache twice + fire two parallel adapter fetches
// (= 2× r.jina.ai rate-limit hit). This map collapses concurrent calls
// for the same URL into a single shared promise. Cleared after settle.
const articleBodyInFlight = new Map<string, Promise<ArticleBody>>

// Module-level cache of the default-worker config so we don't readRaw
// on every fetch. Refreshed on init via setDefaultWorkerCache.
let defaultWorkerCached: { workerUrl: string; bearerToken: string } | null = null
let defaultWorkerInit = false

export function setDefaultWorkerCache(cfg: { workerUrl: string; bearerToken: string } | null): void {
  defaultWorkerCached = cfg
  defaultWorkerInit = true
}

async function getDefaultWorkerCached(): Promise<{ workerUrl: string; bearerToken: string } | null> {
  if (!defaultWorkerInit) {
    defaultWorkerCached = await getDefaultWorker()
    defaultWorkerInit = true
  }
  return defaultWorkerCached
}

export const jinaAdapter: Adapter = {
  async fetchHomepage(source: Source): Promise<Article[]> {
    // Homepage extraction stays on r.jina.ai — the Worker /reader endpoint
    // returns single-article shape, not a list. Future: a /list endpoint
    // could replace this if homepage latency ever becomes a problem.
    const result = await fetchViaJina(source.url)
    return extractArticles(result.markdown, source.url)
  },
  async fetchArticleBody(_source: Source, article: Article): Promise<ArticleBody> {
    // v0.5.6: dedupe concurrent calls for the same URL. Two rapid taps
    // would otherwise both miss the cache + fire two parallel fetches.
    return dedupedFetch(articleBodyInFlight, article.url, async () => {
      // Try the user's Worker first if configured. On any failure (network,
      // HTTP 4xx/5xx, empty body) fall through to r.jina.ai — never block
      // the read because the Worker is down.
      const wcfg = await getDefaultWorkerCached()
      if (wcfg) {
        const w = await fetchViaWorker(wcfg.workerUrl, wcfg.bearerToken, article.url)
        if (w.ok && w.body) {
          const classification = classifyBody(w.body)
          if (classification.ok) {
            return { title: w.title || article.title, body: w.body }
          }
          // Worker returned content but it's classified as paywall / bot-wall /
          // too-short — fall through to jina, which has its own bot-wall
          // bypass via the headless browser.
        }
        // Otherwise fall through silently to the jina path below.
      }
      const result = await fetchViaJina(article.url)
      const classification = classifyBody(result.markdown)
      if (!classification.ok) {
        const reason = classification.reason
        const message =
          reason === 'paywall'
            ? 'This article appears to be behind a paywall. Open it in your browser to read the full text.'
            : reason === 'bot-wall'
              ? 'This site blocks automated access. Try a different source.'
              : 'Article body looks empty — extraction may have failed.'
        return { title: result.title || article.title, body: message, classification: reason }
      }
      return { title: result.title || article.title, body: result.markdown }
    })
  },
  // Mostly informational — the homepage URL is what the user enters.
  homepageUrlForDisplay(source: Source): string {
    return source.url
  },
}
