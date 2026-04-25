import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractArticles } from '../src/extract'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => readFileSync(join(HERE, 'fixtures', name), 'utf8')

describe('extractArticles', () => {
  it('returns article-shaped headlines from the HN homepage', () => {
    const md = fixture('hn-homepage.txt')
    const out = extractArticles(md, 'https://news.ycombinator.com/')
    // HN regularly has ~25-30 stories on the front page; extraction should
    // surface most of them. Tolerance is wide because the live fixture
    // changes; we just want to know the pipeline produces something sensible.
    expect(out.length).toBeGreaterThanOrEqual(15)
    // Headlines should be human-readable strings, not nav cruft.
    for (const a of out.slice(0, 5)) {
      expect(a.title.length).toBeGreaterThanOrEqual(20)
      expect(a.title.length).toBeLessThan(200)
      expect(a.url).toMatch(/^https?:\/\//)
    }
  })

  it('handles cross-domain aggregator links (HN → external articles)', () => {
    const md = fixture('hn-homepage.txt')
    const out = extractArticles(md, 'https://news.ycombinator.com/')
    // HN's value is its external-link aggregation. We should NOT be filtering
    // those out (they used to get killed by an over-strict same-site filter).
    const offSite = out.filter(a => !a.url.includes('ycombinator.com'))
    expect(offSite.length).toBeGreaterThan(5)
  })

  it('returns article links from CNN homepage', () => {
    const md = fixture('cnn-homepage.txt')
    const out = extractArticles(md, 'https://www.cnn.com')
    expect(out.length).toBeGreaterThan(10)
  })

  it('returns article links from BBC News homepage', () => {
    const md = fixture('bbc-homepage.txt')
    const out = extractArticles(md, 'https://www.bbc.com/news')
    expect(out.length).toBeGreaterThan(5)
  })

  it('returns 0 for bot-walled responses (ESPN)', () => {
    const md = fixture('espn-botwall.txt')
    const out = extractArticles(md, 'https://espn.com')
    // The bot-wall response has no markdown links — we should return empty
    // rather than crash. classifyBody handles the "show useful error" side.
    expect(out.length).toBe(0)
  })

  it('filters out nav/utility links', () => {
    // Hand-crafted markdown with mixed real + nav links
    const md = `
[Home](https://example.com/)
[Sign in](https://example.com/login)
[About us](https://example.com/about)
[The actual headline of an interesting article we want to keep](https://example.com/article/important-news-2024)
[Privacy policy](https://example.com/privacy)
[Help](https://example.com/help)
[A second long-enough headline that should be extracted](https://example.com/article/another-thing)
`
    const out = extractArticles(md, 'https://example.com')
    expect(out.length).toBe(2)
    expect(out[0]!.title).toContain('actual headline')
    expect(out[1]!.title).toContain('second long-enough')
  })

  it('dedupes identical URLs even when title differs', () => {
    const md = `
[First link to the same article with one phrasing](https://example.com/x)
[Second link to the same article with different phrasing](https://example.com/x)
`
    const out = extractArticles(md, 'https://example.com')
    expect(out.length).toBe(1)
  })

  it('resolves relative URLs against the source URL', () => {
    const md = `[Long enough headline to pass the title filter test](/article/relative-path)`
    const out = extractArticles(md, 'https://example.com/section/')
    expect(out.length).toBe(1)
    expect(out[0]!.url).toBe('https://example.com/article/relative-path')
  })

  it('returns empty array for empty markdown', () => {
    expect(extractArticles('', 'https://example.com').length).toBe(0)
  })

  it('rejects mailto and javascript links', () => {
    const md = `
[Email us about something interesting that meets the length requirement](mailto:foo@example.com)
[A javascript link that should never be followed in any context](javascript:void(0))
`
    const out = extractArticles(md, 'https://example.com')
    expect(out.length).toBe(0)
  })
})
