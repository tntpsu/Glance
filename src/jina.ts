// r.jina.ai client. Single dependency for fetching — both homepage link
// lists and article bodies use the same endpoint. The service returns a
// plaintext block in this shape:
//
//   Title: Page Title Here
//   URL Source: https://example.com/path
//   Published Time: 2024-01-15T...
//
//   Markdown Content:
//   # Article Title
//   Body...
//
// Free tier: ~200 requests / IP / day, no auth, CORS open. We don't send
// auth headers in v1; deferred to v2.

import type { JinaResult } from './types'

const JINA_BASE = 'https://r.jina.ai/'
const FETCH_TIMEOUT_MS = 30_000 // r.jina.ai's headless browser cold-starts can take 15-25s on first fetch of an unfamiliar site (e.g. CNN); 12s was too tight and surfaced as "timeouts" in real-world use

// Optional API key — set via the phone-side settings page. When present,
// sent as Authorization: Bearer header so r.jina.ai bumps us out of the
// free 200/day per IP per domain rate limit. Synchronous read at call
// time means changing the key in settings takes effect on next fetch.
let cachedJinaApiKey: string | null = null
export function setJinaApiKeyCache(key: string | null): void {
  cachedJinaApiKey = key && key.trim() ? key.trim() : null
}

export class JinaError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly url?: string,
  ) {
    super(message)
    this.name = 'JinaError'
  }
}

// Fetch-log hook. main.ts wires up a buffer at boot so the phone-side
// debug panel can show the last N fetches. Decoupled so jina.ts can
// stay independent of any UI module. The callback runs synchronously
// after each fetch returns (success or error) — must not throw.
export interface JinaFetchLog {
  ts: number
  url: string
  via: 'r.jina.ai'
  status: number | null    // null = network failure / aborted
  ms: number
  ok: boolean
  error?: string           // user-friendly summary
  bytes?: number
}

let logSink: ((entry: JinaFetchLog) => void) | null = null
export function setJinaLogger(sink: ((entry: JinaFetchLog) => void) | null): void {
  logSink = sink
}

// Translate a non-2xx HTTP status into a user-readable explanation.
// 451 (Unavailable for Legal Reasons) is what r.jina.ai surfaces when
// the upstream blocks them on copyright / geo / DMCA grounds.
function explainHttpStatus(status: number): string {
  if (status === 451) return 'r.jina.ai cannot serve this article (legal block — copyright or region).'
  if (status === 403) return 'r.jina.ai was blocked by the site (bot wall / Cloudflare).'
  if (status === 429) return 'r.jina.ai rate-limited this fetch. Try again in a minute, or set your Jina API key in settings to lift the limit.'
  if (status === 422) return 'r.jina.ai cannot extract this URL (probably a non-article page or malformed link).'
  if (status === 504) return 'r.jina.ai timed out fetching the upstream site. Retry; the headless browser cold-starts can take a while.'
  if (status >= 500) return `r.jina.ai upstream error (${status}). Retry shortly.`
  if (status === 404) return 'Article URL not found upstream.'
  return `r.jina.ai returned ${status}.`
}

function parseJinaResponse(text: string, requestedUrl: string): JinaResult {
  // The format is forgiving — we look for the labeled blocks anywhere in
  // the response and fall back to the whole body as markdown if the
  // headers aren't found.
  const titleMatch = text.match(/^Title:\s*(.+?)$/m)
  const urlMatch = text.match(/^URL Source:\s*(.+?)$/m)
  const publishedMatch = text.match(/^Published Time:\s*(.+?)$/m)
  const contentMatch = text.match(/Markdown Content:\s*\n([\s\S]*)$/)
  const markdown = (contentMatch ? contentMatch[1] : text).trim()
  return {
    title: titleMatch ? titleMatch[1]!.trim() : 'Untitled',
    sourceUrl: urlMatch ? urlMatch[1]!.trim() : requestedUrl,
    publishedTime: publishedMatch?.[1]?.trim(),
    markdown,
  }
}

// Heuristic paywall / bot-wall detection. r.jina.ai's headless Chromium
// is unauthed, so paywalled articles return their teaser + "subscribe"
// nag, and Cloudflare-protected sites return a JS challenge page. Both
// look like very short bodies with telltale phrases.
const PAYWALL_PATTERNS = [
  /subscribe to continue/i,
  /this article is for subscribers/i,
  /subscribers? only/i,
  /sign in to (?:continue|read)/i,
  /create a free account/i,
  /already a subscriber/i,
  /unlock (?:this|the) (?:story|article)/i,
  /(?:javascript|js) is (?:disabled|required)/i,
  /verify (?:that )?you'?re not a (?:robot|bot)/i,
  /cloudflare/i,
]

export interface BodyClassification {
  ok: boolean
  reason?: 'too-short' | 'paywall' | 'bot-wall'
}

export function classifyBody(markdown: string): BodyClassification {
  const trimmed = markdown.trim()
  if (trimmed.length < 200) return { ok: false, reason: 'too-short' }
  // Check the first 600 chars — paywall nags appear at the top after the
  // teaser; bot-wall messages dominate the whole short body.
  const top = trimmed.slice(0, 600)
  for (const re of PAYWALL_PATTERNS) {
    if (re.test(top)) {
      return { ok: false, reason: /robot|cloudflare|javascript/i.test(re.source) ? 'bot-wall' : 'paywall' }
    }
  }
  return { ok: true }
}

export async function fetchViaJina(url: string): Promise<JinaResult> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const target = JINA_BASE + url
  const startedAt = Date.now()
  try {
    const headers: Record<string, string> = { Accept: 'text/plain' }
    if (cachedJinaApiKey) headers.Authorization = `Bearer ${cachedJinaApiKey}`
    const resp = await fetch(target, {
      headers,
      signal: controller.signal,
    })
    if (!resp.ok) {
      const friendly = explainHttpStatus(resp.status)
      logSink?.({
        ts: startedAt, url, via: 'r.jina.ai',
        status: resp.status, ms: Date.now() - startedAt, ok: false, error: friendly,
      })
      throw new JinaError(friendly, resp.status, url)
    }
    const text = await resp.text()
    if (!text || text.length < 32) {
      logSink?.({
        ts: startedAt, url, via: 'r.jina.ai',
        status: resp.status, ms: Date.now() - startedAt, ok: false,
        error: 'r.jina.ai returned an empty body.', bytes: text.length,
      })
      throw new JinaError('r.jina.ai returned an empty response', resp.status, url)
    }
    logSink?.({
      ts: startedAt, url, via: 'r.jina.ai',
      status: resp.status, ms: Date.now() - startedAt, ok: true, bytes: text.length,
    })
    return parseJinaResponse(text, url)
  } catch (err) {
    if (err instanceof JinaError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      logSink?.({
        ts: startedAt, url, via: 'r.jina.ai',
        status: null, ms: Date.now() - startedAt, ok: false,
        error: `Timed out after ${FETCH_TIMEOUT_MS / 1000}s. r.jina.ai cold-start on unfamiliar sites can take 15-25s — retry once.`,
      })
      throw new JinaError('r.jina.ai timed out', undefined, url)
    }
    const message = err instanceof Error ? err.message : String(err)
    logSink?.({
      ts: startedAt, url, via: 'r.jina.ai',
      status: null, ms: Date.now() - startedAt, ok: false, error: `Network error: ${message}`,
    })
    throw new JinaError(`fetch failed: ${message}`, undefined, url)
  } finally {
    window.clearTimeout(timer)
  }
}
