#!/usr/bin/env node
// Capture raw r.jina.ai output for a curated set of news sites and save
// to tests/fixtures/<name>.md. The fixtures feed
// tests/extraction-fixtures.test.ts which runs paginate.strip() against
// them deterministically — without this, the only way to validate the
// chrome filter is live-fetching, which is slow + nondeterministic +
// gets rate-limited.
//
// Run: node scripts/refresh-fixtures.mjs
//
// Skips sites that 4xx/5xx (their fixture stays as-is from the previous
// successful run). Run after a meaningful filter change OR after ~2
// months when fixtures get stale.

import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const JINA_BASE = 'https://r.jina.ai/'
const FETCH_TIMEOUT_MS = 30_000
const FIXTURES_DIR = 'tests/fixtures'

// Curated set: the four default Glance sources + 8 popular news/long-form
// sites users would add via "Add a generic source." Each entry uses an
// article URL (not a homepage) so the fixture exercises the article-body
// path the user actually hits.
//
// URLs were verified live on 2026-04-26. r.jina.ai may 451 some over
// time (legal blocks change); the script just skips those and leaves
// the previous fixture intact.
const FIXTURES = [
  { name: 'cnn',       url: 'https://www.cnn.com/2026/04/25/travel/travel-news-worlds-biggest-capsule-hotel' },
  { name: 'bbc',       url: 'https://www.bbc.com/news/articles/c15d57pv925o' },
  { name: 'hn-medium', url: 'https://ca98am79.medium.com/i-bought-friendster-for-30k-heres-what-i-m-doing-wit' },
  { name: 'yahoo',     url: 'https://news.yahoo.com/' },
  { name: 'reuters',   url: 'https://www.reuters.com/world/' },
  { name: 'npr',       url: 'https://www.npr.org/sections/news/' },
  { name: 'techcrunch',url: 'https://techcrunch.com/' },
  { name: 'theverge',  url: 'https://www.theverge.com/tech' },
  { name: 'arstechnica',url:'https://arstechnica.com/' },
  { name: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Cloudflare' },
  { name: 'substack',  url: 'https://stratechery.com/' },
  // v0.5.4 round 2 — coverage for structurally-different chrome patterns
  // and one user-specific site (on3 college sports).
  { name: 'guardian',  url: 'https://www.theguardian.com/international' },
  { name: 'reddit',    url: 'https://www.reddit.com/r/programming/' },
  { name: 'nyt',       url: 'https://www.nytimes.com/section/world' },
  { name: 'stackoverflow', url: 'https://stackoverflow.com/questions/231767/what-does-the-yield-keyword-do-in-python' },
  { name: 'nyt-cooking', url: 'https://cooking.nytimes.com/' },
  { name: 'github',    url: 'https://github.com/microsoft/vscode' },
  { name: 'on3',       url: 'https://www.on3.com/teams/penn-state-nittany-lions/' },
]

async function fetchOnce(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(JINA_BASE + url, {
      headers: { Accept: 'text/plain' },
      signal: ctrl.signal,
    })
    if (!resp.ok) return { ok: false, status: resp.status }
    const text = await resp.text()
    return { ok: true, text }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true })
  console.log(`Refreshing ${FIXTURES.length} fixtures into ${FIXTURES_DIR}/`)
  let saved = 0
  let skipped = 0
  for (const { name, url } of FIXTURES) {
    process.stdout.write(`  ${name.padEnd(13)} `)
    const r = await fetchOnce(url)
    const path = join(FIXTURES_DIR, `${name}.md`)
    if (!r.ok) {
      const exists = existsSync(path) ? '(prev fixture kept)' : '(no prev fixture)'
      console.log(`✗ ${r.status ?? r.error} ${exists}`)
      skipped += 1
      continue
    }
    // Preserve the FULL jina response (including the Title:/URL Source:/
    // Markdown Content: header) so tests can choose to parse or not.
    await writeFile(path, r.text)
    console.log(`✓ ${(r.text.length / 1024).toFixed(1)} KB`)
    saved += 1
    // Be polite — small delay between requests so we don't trip jina's
    // per-IP rate limit on the same minute.
    await new Promise(r => setTimeout(r, 800))
  }
  console.log(`\nSaved ${saved}, skipped ${skipped}.`)
}

main().catch(err => {
  console.error('FATAL:', err.message)
  process.exit(1)
})
