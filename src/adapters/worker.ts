// Worker adapter — routes article-body extraction through a personal
// Cloudflare Worker that the user has deployed (see worker-template/).
// Designed for auth-walled sites (Rivals, NYT-with-account, paid forums)
// that r.jina.ai can't reach because the Worker can carry the user's
// session cookies.
//
// Source schema:
//   url: the homepage URL of the auth-walled site (used for extraction
//        of the article LIST — Glance still uses jina for that, since
//        the homepage rarely needs auth).
//   adapter: 'worker'
//   adapterConfig: {
//     workerUrl: 'https://glance-reader.<sub>.workers.dev',
//     bearerToken: '<SHARED_SECRET>',
//   }
//
// fetchHomepage delegates to jina (homepage usually accessible without auth).
// fetchArticleBody hits the user's Worker with cookies for full body.

import { extractArticles } from '../extract'
import { classifyBody, fetchViaJina } from '../jina'
import type { Adapter, ArticleBody } from './index'
import type { Article, Source } from '../types'

const FETCH_TIMEOUT_MS = 15_000 // Worker fetch + readability + return — give it room

interface WorkerResponse {
  ok: boolean
  title?: string
  body?: string
  error?: string
}

function workerConfig(source: Source): { workerUrl: string; bearerToken: string } | null {
  const cfg = source.adapterConfig as { workerUrl?: string; bearerToken?: string } | undefined
  if (!cfg?.workerUrl || !cfg.bearerToken) return null
  return { workerUrl: cfg.workerUrl.replace(/\/$/, ''), bearerToken: cfg.bearerToken }
}

export const workerAdapter: Adapter = {
  async fetchHomepage(source: Source): Promise<Article[]> {
    // Homepage usually doesn't need auth — try jina first. If it returns
    // empty / paywall, the user can re-add the source pointing at a
    // member-area URL and we'll route through the Worker for that too,
    // but most sites have public homepages even when articles are walled.
    const result = await fetchViaJina(source.url)
    return extractArticles(result.markdown, source.url)
  },
  async fetchArticleBody(source: Source, article: Article): Promise<ArticleBody> {
    const cfg = workerConfig(source)
    if (!cfg) {
      return {
        title: article.title,
        body: 'Worker source missing workerUrl or bearerToken. Re-add this source from the phone settings.',
        classification: 'too-short',
      }
    }
    const target = `${cfg.workerUrl}/reader?url=${encodeURIComponent(article.url)}`
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const resp = await fetch(target, {
        headers: {
          Authorization: `Bearer ${cfg.bearerToken}`,
          Accept: 'application/json',
        },
        signal: ctrl.signal,
      })
      if (!resp.ok) {
        return {
          title: article.title,
          body: `Worker error: HTTP ${resp.status}. Check that the Worker is deployed and SHARED_SECRET matches.`,
          classification: 'bot-wall',
        }
      }
      const json = (await resp.json()) as WorkerResponse
      if (!json.ok || !json.body) {
        const errMsg = json.error || 'Worker returned no body — site may have changed structure or cookies expired.'
        return {
          title: article.title,
          body: errMsg,
          classification: 'too-short',
        }
      }
      const classification = classifyBody(json.body)
      if (!classification.ok) {
        return {
          title: json.title || article.title,
          body: classification.reason === 'paywall'
            ? 'Article is still paywalled even with cookies. Session may have expired — refresh cookies in your Worker.'
            : 'Worker returned an unusable body.',
          classification: classification.reason,
        }
      }
      return { title: json.title || article.title, body: json.body }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        title: article.title,
        body: `Worker unreachable: ${message}`,
        classification: 'bot-wall',
      }
    } finally {
      window.clearTimeout(timer)
    }
  },
  homepageUrlForDisplay(source: Source): string {
    return source.url
  },
}
