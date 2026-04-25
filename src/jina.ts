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
const FETCH_TIMEOUT_MS = 12_000 // r.jina.ai's headless browser can be slow on first fetch

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

export async function fetchViaJina(url: string): Promise<JinaResult> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const target = JINA_BASE + url
  try {
    const resp = await fetch(target, {
      headers: { Accept: 'text/plain' },
      signal: controller.signal,
    })
    if (!resp.ok) {
      throw new JinaError(`r.jina.ai returned ${resp.status}`, resp.status, url)
    }
    const text = await resp.text()
    if (!text || text.length < 32) {
      throw new JinaError('r.jina.ai returned an empty response', resp.status, url)
    }
    return parseJinaResponse(text, url)
  } catch (err) {
    if (err instanceof JinaError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new JinaError('r.jina.ai timed out', undefined, url)
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new JinaError(`fetch failed: ${message}`, undefined, url)
  } finally {
    window.clearTimeout(timer)
  }
}
