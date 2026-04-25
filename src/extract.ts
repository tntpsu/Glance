// Extract article-shaped links from the markdown returned by r.jina.ai for
// a homepage. The strategy is permissive — pull every markdown link, then
// filter against patterns that look like nav/footer/category cruft. Per-site
// scrapers are intentionally avoided so the app degrades gracefully when
// sites redesign.

import type { Article } from './types'

// Markdown link regex — handles []() with optional title text.
// Also matches reference-style? No — r.jina.ai always emits inline links.
const MARKDOWN_LINK_RE = /\[([^\]]{1,200})\]\(([^)]+)\)/g

// Patterns in URL paths that indicate nav / utility / category pages.
// Hit any → drop the link.
const URL_BLOCKLIST = [
  /\/login/i,
  /\/signup/i,
  /\/account/i,
  /\/help/i,
  /\/support/i,
  /\/about/i,
  /\/contact/i,
  /\/privacy/i,
  /\/terms/i,
  /\/cookies?$/i,
  /\/search\b/i,
  /\/subscribe/i,
  /\/profile/i,
  /\/settings/i,
  /\/category\//i,
  /\/tag\//i,
  /\/author\//i,
  /^https?:\/\/[^/]+\/?$/i, // bare-domain link → not an article
  /\.(jpg|jpeg|png|gif|svg|webp|mp4|pdf|zip)(\?|$)/i,
  /^mailto:/i,
  /^tel:/i,
  /^javascript:/i,
  /^#/, // anchor-only
]

// Titles too short or too long are usually not headlines.
const TITLE_MIN_CHARS = 20
const TITLE_MAX_CHARS = 200

// Common nav-anchor titles (case-insensitive exact match).
const TITLE_BLOCKLIST = new Set([
  'home',
  'menu',
  'sign in',
  'sign up',
  'log in',
  'subscribe',
  'newsletter',
  'more',
  'continue reading',
  'read more',
  'share',
  'save',
  'comments',
  'opinion',
  'sports',
  'business',
  'world',
  'us',
  'politics',
  'tech',
])

function safeUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function looksArticleish(rawTitle: string, url: string): boolean {
  // Quick blocklist hits.
  for (const pattern of URL_BLOCKLIST) {
    if (pattern.test(url)) return false
  }
  const title = rawTitle.trim().toLowerCase()
  if (TITLE_BLOCKLIST.has(title)) return false
  if (rawTitle.length < TITLE_MIN_CHARS) return false
  if (rawTitle.length > TITLE_MAX_CHARS) return false
  // Note: NO same-site filter. Aggregators (HN, Reddit-style) link to
  // external articles by design, and we want those. Title-length plus
  // URL_BLOCKLIST already filter most non-article cruft.
  const domain = extractDomain(url)
  if (!domain) return false
  return true
}

function sameSite(a: string, b: string): boolean {
  const norm = (h: string) => h.replace(/^www\./, '')
  return norm(a).endsWith(norm(b)) || norm(b).endsWith(norm(a))
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+/g, ' ') // collapse internal whitespace
    .replace(/^[\s​-‏]+|[\s​-‏]+$/g, '')
}

export function extractArticles(markdown: string, sourceUrl: string): Article[] {
  const seen = new Set<string>()
  const out: Article[] = []

  // Iterate matches in document order so the editorial relevance of the
  // homepage is preserved.
  let m: RegExpExecArray | null
  MARKDOWN_LINK_RE.lastIndex = 0
  while ((m = MARKDOWN_LINK_RE.exec(markdown)) !== null) {
    const rawTitle = cleanTitle(m[1] ?? '')
    const rawHref = (m[2] ?? '').trim().split(/\s+/)[0] ?? '' // strip optional title-suffix
    if (!rawTitle || !rawHref) continue
    const abs = safeUrl(rawHref, sourceUrl)
    if (!abs) continue
    if (seen.has(abs)) continue
    if (!looksArticleish(rawTitle, abs)) continue
    seen.add(abs)
    out.push({ title: rawTitle, url: abs })
  }
  return out
}

export const __test__ = { sameSite, looksArticleish, cleanTitle }
