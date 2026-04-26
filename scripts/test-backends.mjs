#!/usr/bin/env node
// Integration test against the real backends Glance depends on. Catches
// schema drift in r.jina.ai or ESPN news API that would silently break
// reading.
//
// Run:
//   node scripts/test-backends.mjs

const PASS = []
const FAIL = []
function ok(name, detail = '') { console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); PASS.push(name) }
function fail(name, detail) { console.log(`  ✗ ${name} — ${detail}`); FAIL.push({ name, detail }) }

async function probe(label, url, opts = {}) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 30_000)
    const res = await fetch(url, { signal: ctrl.signal, headers: opts.headers })
    clearTimeout(timer)
    if (!res.ok) { fail(label, `HTTP ${res.status}`); return null }
    if (opts.json) return { res, body: await res.json() }
    return { res, text: await res.text() }
  } catch (err) {
    fail(label, err instanceof Error ? err.message : String(err))
    return null
  }
}

console.log('Glance backend integration tests')
console.log()

// 1. r.jina.ai homepage extraction (the default adapter for any source)
{
  const r = await probe('jina extracts a real homepage', 'https://r.jina.ai/https://news.ycombinator.com')
  if (r) {
    const looksLikeMarkdown = /^Title: |^URL Source: |^Markdown Content:/m.test(r.text.slice(0, 500))
    if (!looksLikeMarkdown) fail('jina markdown shape', 'response does not look like Jina markdown')
    else ok('jina extracts a real homepage', `${r.text.length} chars`)
  }
}

// 2. r.jina.ai handles a real article URL
{
  const url = 'https://r.jina.ai/https://lite.cnn.com/' // CNN lite — known stable, light HTML
  const r = await probe('jina extracts a stable news site', url)
  if (r) {
    if (r.text.length < 200) fail('jina text length', `only ${r.text.length} chars`)
    else ok('jina extracts a stable news site', `${r.text.length} chars`)
  }
}

// 3. ESPN news endpoint (used by espn-news adapter)
{
  for (const league of ['football/nfl', 'basketball/nba']) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league}/news?limit=5`
    const r = await probe(`ESPN news ${league}`, url, { json: true })
    if (r) {
      const articles = r.body?.articles
      if (!Array.isArray(articles)) fail(`ESPN ${league} shape`, 'articles not array')
      else if (articles.length === 0) fail(`ESPN ${league} shape`, 'no articles returned')
      else {
        // Schema spot-check: articles need headline + links.web.href
        const a = articles[0]
        if (!a.headline) fail(`ESPN ${league} schema`, 'first article missing headline')
        else if (!a.links?.web?.href) fail(`ESPN ${league} schema`, 'first article missing links.web.href')
        else ok(`ESPN news ${league}`, `${articles.length} articles, schema OK`)
      }
    }
  }
}

console.log()
console.log(`Result: ${PASS.length} passed, ${FAIL.length} failed`)
if (FAIL.length > 0) {
  console.log('Failures:')
  for (const f of FAIL) console.log(`  - ${f.name}: ${f.detail}`)
  process.exit(1)
}
