#!/usr/bin/env node
// Real-world extraction test. Fetches one article from each default source
// via r.jina.ai, runs the actual paginate.strip() pipeline, and prints:
//   - raw chars in
//   - chars out after filter
//   - first ~600 chars of the cleaned body
//   - any lines that look like leftover chrome we should add to the filter
//
// Run: node scripts/test-extraction.mjs
//
// Skips ESPN (returns summaries only via API adapter, not jina).

import { paginate } from '../src/paginate.ts'
import { extractArticles } from '../src/extract.ts'

const JINA_BASE = 'https://r.jina.ai/'
const FETCH_TIMEOUT_MS = 30_000

// Realistic flow: fetch the homepage, extract the first plausible article
// URL via the same extractArticles() the app uses, then fetch THAT body
// and run paginate against it. Matches what the user actually sees on
// glasses (article body, not homepage scrape).
const PROBES = [
  { source: 'CNN',         homepage: 'https://www.cnn.com/' },
  { source: 'BBC News',    homepage: 'https://www.bbc.com/news' },
  { source: 'Hacker News', homepage: 'https://news.ycombinator.com' },
  { source: 'Yahoo News',  homepage: 'https://news.yahoo.com' },
]

async function fetchViaJinaPlain(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(JINA_BASE + url, {
      headers: { Accept: 'text/plain' },
      signal: ctrl.signal,
    })
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` }
    const text = await resp.text()
    const contentMatch = text.match(/Markdown Content:\s*\n([\s\S]*)$/)
    const markdown = (contentMatch ? contentMatch[1] : text).trim()
    return { ok: true, markdown, total: text.length }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    clearTimeout(timer)
  }
}

// Heuristic: lines ≤ 4 words that aren't questions / quotes are
// probably still-leaking chrome we don't have a pattern for yet.
function suspiciousLeftoverLines(cleanedText) {
  const lines = cleanedText.split('\n').filter(l => l.trim().length > 0)
  return lines.filter(l => {
    const t = l.trim()
    if (t.length > 60) return false
    if (t.endsWith('?') || t.endsWith('.') || t.endsWith('!')) return false
    const wordCount = t.split(/\s+/).length
    if (wordCount > 4) return false
    if (/^\d/.test(t)) return false   // numeric lists are usually fine
    return true
  })
}

async function main() {
  console.log('Real-world extraction test: homepage → article → paginate.strip()\n')
  for (const probe of PROBES) {
    console.log(`═══ ${probe.source} ═══`)
    console.log(`  1. Fetch homepage: ${probe.homepage}`)
    const home = await fetchViaJinaPlain(probe.homepage)
    if (!home.ok) {
      console.log(`     ✗ ${home.error}\n`)
      continue
    }
    const articles = extractArticles(home.markdown, probe.homepage)
    if (articles.length === 0) {
      console.log(`     ✗ no article URLs extracted from homepage\n`)
      continue
    }
    const article = articles[0]
    console.log(`     ✓ found ${articles.length} articles, picking #1: "${article.title.slice(0, 60)}"`)
    console.log(`  2. Fetch article body: ${article.url.slice(0, 80)}`)
    const body = await fetchViaJinaPlain(article.url)
    if (!body.ok) {
      console.log(`     ✗ ${body.error}\n`)
      continue
    }
    const pages = paginate(body.markdown, 100_000)
    const cleaned = pages.join('\n')
    console.log(`  3. Paginate.strip() result:`)
    console.log(`     raw:     ${body.markdown.length} chars`)
    console.log(`     cleaned: ${cleaned.length} chars (${Math.round(100 * (1 - cleaned.length / body.markdown.length))}% removed)`)
    console.log(`  4. First 600 chars of cleaned body:`)
    console.log(`  ┌${'─'.repeat(70)}`)
    cleaned.slice(0, 600).split('\n').forEach(l => console.log(`  │ ${l}`))
    console.log(`  └${'─'.repeat(70)}`)
    const sus = suspiciousLeftoverLines(cleaned).slice(0, 15)
    if (sus.length > 0) {
      console.log(`  5. Suspicious leftover short lines (chrome we should drop):`)
      sus.forEach(s => console.log(`     "${s.trim()}"`))
    } else {
      console.log(`  5. ✓ No obvious chrome leakage`)
    }
    console.log()
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
