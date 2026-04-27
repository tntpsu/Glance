// Fixture-driven extraction tests. Each .md file in tests/fixtures/ is a
// raw r.jina.ai response captured by scripts/refresh-fixtures.mjs. The
// test runs the actual paginate.strip() filter against each and asserts:
//
//   1. Some real content survived (not 100% removed)
//   2. Known chrome patterns are NOT in the cleaned output
//   3. Meaningful chrome WAS removed (filter is doing real work)
//
// Why fixtures vs live fetching:
// - Deterministic — no flakes from r.jina.ai 503/451/timeouts
// - Fast — runs in <100ms vs 30s+ for live
// - Reproducible — anyone can run npm test, no rate-limit surprises
// - The chrome filter is the unit under test, not r.jina.ai itself
//
// Refresh fixtures: node scripts/refresh-fixtures.mjs
// Run when: filter changes meaningfully OR fixtures get stale (~2 months).

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { paginate } from '../src/paginate'

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures')

// Extract just the Markdown Content block from a raw jina response —
// matches the parsing in src/jina.ts so tests exercise the same path.
function parseJinaMarkdown(raw: string): string {
  const m = raw.match(/Markdown Content:\s*\n([\s\S]*)$/)
  return (m ? m[1]! : raw).trim()
}

// Patterns that should NEVER appear in cleaned output. If any of these
// match, the chrome filter regressed and a previously-handled case is
// leaking through. Each pattern is anchored to a real-world finding.
const REGRESSION_GUARDS: Array<{ name: string; re: RegExp }> = [
  { name: 'bare empty-text anchor',     re: /^\[\]\([^)]+\)\s*$/m },
  { name: 'bullet-prefixed nav (Home/News/Sport)', re: /^[•\-*+]\s+(Home|News|Sport|Politics|Business|Technology|Health|Culture|Earth|Audio|Video|Live|Documentaries)\s*$/im },
  { name: 'CNN ad-feedback prompt',     re: /^\d+\.\s+How relevant is this ad/im },
  { name: 'CNN ad-feedback prompt 2',   re: /^\d+\.\s+Did you encounter any technical issues/im },
  { name: 'CNN values your feedback',   re: /^.{1,30} values your feedback/im },
  { name: 'multi-checkbox form line',   re: /\[x\][^[]{1,80}\[x\][^[]{1,80}\[x\]/i },
  { name: 'sponsored content',          re: /^sponsored content$/im },
  { name: 'show comments',              re: /^show (more |all |full )?comments?$/im },
  { name: 'related stories',            re: /^related stories$/im },
  { name: 'follow CTA',                 re: /^Follow (CNN|BBC|NYT) /m },
  { name: 'download app CTA',           re: /^Download the .{1,30} App$/im },
  { name: 'orphan bullet line',         re: /^[•\-*+]\s*$/m },
  { name: 'thank-you blurb',            re: /^Thank You!?$/im },
]

// Each fixture has at least one snippet that must survive the filter —
// catches the "filter ate the whole article" regression. Snippets are
// tuned to ACTUAL fixture content (not the URL we wished we had — some
// fixtures captured a homepage or 404 page, which is still valid real-
// world data for chrome-filter testing). Re-tune when refresh-fixtures
// captures meaningfully different content.
const POSITIVE_SNIPPETS: Record<string, string[]> = {
  cnn:        ['London', 'capsule'],
  bbc:        ['Oil prices', 'barrel'],
  'hn-medium':['PAGE NOT FOUND'],  // fixture captured a Medium 404 page
  yahoo:      ['Afghanistan'],
  npr:        ['News'],
  techcrunch: ['TechCrunch', 'Startup'],  // homepage scrape
  theverge:   ['Verge'],
  arstechnica:['Ars'],
  wikipedia:  ['Cloudflare'],
  substack:   ['Stratechery'],
}

function listFixtures(): Array<{ name: string; path: string }> {
  return readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => ({ name: f.replace(/\.md$/, ''), path: join(FIXTURES_DIR, f) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const fixtures = listFixtures()

describe('extraction fixtures (real-world articles)', () => {
  it('has fixtures to test', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8)
  })

  for (const fx of fixtures) {
    describe(fx.name, () => {
      const raw = readFileSync(fx.path, 'utf-8')
      const markdown = parseJinaMarkdown(raw)
      const cleanedPages = paginate(markdown, 100_000)
      const cleaned = cleanedPages.join('\n')

      it('produces non-empty cleaned output', () => {
        expect(cleaned.length).toBeGreaterThan(200)
      })

      it('removes meaningful chrome (>10% reduction)', () => {
        const reduction = 1 - cleaned.length / markdown.length
        expect(reduction).toBeGreaterThan(0.1)
      })

      // Each REGRESSION_GUARD becomes its own test for clear failure messages.
      for (const guard of REGRESSION_GUARDS) {
        it(`does NOT contain ${guard.name}`, () => {
          const match = guard.re.exec(cleaned)
          if (match) {
            // Print surrounding context so the failure is actionable
            const idx = match.index
            const ctx = cleaned.slice(Math.max(0, idx - 40), Math.min(cleaned.length, idx + 120))
            throw new Error(
              `Chrome leaked: "${guard.name}"\n  matched: ${JSON.stringify(match[0])}\n  context: ...${ctx}...`,
            )
          }
        })
      }

      // Positive snippet check — does the actual article body survive?
      const snippets = POSITIVE_SNIPPETS[fx.name] ?? []
      for (const snippet of snippets) {
        it(`preserves article content: "${snippet}"`, () => {
          expect(cleaned).toContain(snippet)
        })
      }
    })
  }
})
