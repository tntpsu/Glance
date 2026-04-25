import { describe, expect, it } from 'vitest'
import { DEFAULT_SOURCES, looksLikeUrl, makeSource } from '../src/sources'

describe('looksLikeUrl', () => {
  it('accepts well-formed http and https URLs', () => {
    expect(looksLikeUrl('https://example.com')).toBe(true)
    expect(looksLikeUrl('https://example.com/path')).toBe(true)
    expect(looksLikeUrl('http://localhost:5173')).toBe(true)
    expect(looksLikeUrl('https://news.ycombinator.com')).toBe(true)
  })

  it('rejects URLs with no host', () => {
    expect(looksLikeUrl('')).toBe(false)
    expect(looksLikeUrl('http://')).toBe(false)
    expect(looksLikeUrl('https:///path')).toBe(false)
  })

  it('rejects non-http(s) schemes', () => {
    expect(looksLikeUrl('ftp://example.com')).toBe(false)
    expect(looksLikeUrl('mailto:foo@bar.com')).toBe(false)
    expect(looksLikeUrl('javascript:alert(1)')).toBe(false)
    expect(looksLikeUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects garbage', () => {
    expect(looksLikeUrl('not a url')).toBe(false)
    expect(looksLikeUrl('   ')).toBe(false)
    expect(looksLikeUrl('example.com')).toBe(false) // no scheme → invalid
  })
})

describe('makeSource', () => {
  it('trims whitespace from title and url', () => {
    const s = makeSource('  My Site  ', '  https://example.com  ')
    expect(s.title).toBe('My Site')
    expect(s.url).toBe('https://example.com')
  })

  it('assigns a unique id', () => {
    const a = makeSource('A', 'https://a.com')
    const b = makeSource('B', 'https://b.com')
    expect(a.id).not.toBe(b.id)
    expect(a.id).toMatch(/^src_/)
  })
})

describe('DEFAULT_SOURCES', () => {
  it('ships a reasonable number of sources (4-10)', () => {
    expect(DEFAULT_SOURCES.length).toBeGreaterThanOrEqual(4)
    expect(DEFAULT_SOURCES.length).toBeLessThanOrEqual(10)
  })

  it('every source has a non-empty title and unique id', () => {
    const ids = new Set<string>()
    for (const s of DEFAULT_SOURCES) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.id).toBeTruthy()
      expect(ids.has(s.id)).toBe(false)
      ids.add(s.id)
    }
  })

  it('jina-adapter defaults are real http(s) URLs', () => {
    // Synthetic adapter URLs (inbox://, espn-news://) are intentionally
    // not http(s) — they're identifiers for the adapter to interpret,
    // never sent to fetch().
    const jinaSources = DEFAULT_SOURCES.filter(s => !s.adapter || s.adapter === 'jina')
    expect(jinaSources.length).toBeGreaterThan(0)
    for (const s of jinaSources) {
      expect(looksLikeUrl(s.url)).toBe(true)
    }
  })

  it('inbox and espn-news defaults use synthetic adapter URLs', () => {
    const synthetic = DEFAULT_SOURCES.filter(
      s => s.adapter === 'inbox' || s.adapter === 'espn-news',
    )
    for (const s of synthetic) {
      // Adapter sources have a scheme that signals which adapter handles them.
      expect(s.url).toMatch(/^(inbox|espn-news):\/\//)
      expect(s.adapter).toBeTruthy()
    }
  })

  it('exactly one inbox default exists (★ Saved articles)', () => {
    const inbox = DEFAULT_SOURCES.filter(s => s.adapter === 'inbox')
    expect(inbox.length).toBe(1)
    expect(inbox[0]!.url).toBe('inbox://saved')
  })
})
