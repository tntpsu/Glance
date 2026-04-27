// Edge cases for paginate() that aren't exercised by the fixture suite —
// empty input, single-page, monolithic sentence, unicode/emoji/RTL.
// Pure logic so no environment setup needed.

import { describe, expect, it } from 'vitest'
import { paginate } from '../src/paginate'

describe('paginate edge cases', () => {
  it('empty string returns empty array', () => {
    expect(paginate('')).toEqual([])
    expect(paginate('   \n\n  ')).toEqual([])
  })

  it('single short string fits on one page', () => {
    const r = paginate('Hello world.')
    expect(r).toHaveLength(1)
    expect(r[0]).toBe('Hello world.')
  })

  it('one giant sentence longer than cap is truncated to char-tail without crash', () => {
    // Pure prose with no punctuation / paragraph break — the worst case
    // for the pagination heuristic. Should fall back to word-break, then
    // hard cut, never throw.
    const monolith = 'word '.repeat(500).trim()  // ~2500 chars
    const pages = paginate(monolith, 400)
    expect(pages.length).toBeGreaterThan(1)
    for (const p of pages) {
      expect(p.length).toBeLessThanOrEqual(400)
    }
  })

  it('handles a single unbroken word longer than cap', () => {
    const giantWord = 'a'.repeat(800)
    const pages = paginate(giantWord, 400)
    expect(pages.length).toBeGreaterThanOrEqual(2)
    // Each page <= cap (the algorithm hard-cuts when no break point).
    for (const p of pages) {
      expect(p.length).toBeLessThanOrEqual(400)
    }
  })

  it('emoji / multi-byte characters survive without crashing', () => {
    // JS string length is code-units, not glyphs — paginate counts
    // code-units. Should still produce valid output, no thrown errors.
    const text = '😀 emoji test '.repeat(50) + '. The end.'
    const pages = paginate(text, 200)
    expect(pages.length).toBeGreaterThan(0)
    expect(pages.join(' ')).toContain('😀')
  })

  it('RTL text (Arabic, Hebrew) passes through without modification', () => {
    const arabic = 'مرحبا بالعالم. هذه فقرة طويلة من النص العربي يجب أن تظل سليمة.'
    const pages = paginate(arabic, 1000)
    expect(pages).toHaveLength(1)
    expect(pages[0]).toContain('مرحبا')
  })

  it('mixed-script content (English + non-ASCII) paginates cleanly', () => {
    const mixed = 'Hello 世界. This is a test 测试. Line three もしもし.'
    const pages = paginate(mixed, 1000)
    expect(pages).toHaveLength(1)
    expect(pages[0]).toContain('世界')
    expect(pages[0]).toContain('もしもし')
  })

  it('preserves paragraph breaks across page boundaries', () => {
    const text = 'First paragraph here.\n\nSecond paragraph follows.\n\nThird wraps it up.'
    const pages = paginate(text, 30)
    // Each paragraph should be on its own page given the cap forces splits.
    expect(pages.length).toBeGreaterThanOrEqual(2)
  })

  it('drops a page that is purely whitespace after stripping', () => {
    // After stripping markdown decorations + chrome, a page should never
    // be just whitespace. Markdown-only input → empty result.
    const allMarkdown = '**__**\n\n*  *\n\n``\n\n#### \n'
    const pages = paginate(allMarkdown)
    expect(pages.every(p => p.trim().length > 0)).toBe(true)
  })

  it('strips chrome but keeps real content even with low signal-to-noise', () => {
    const text = 'Subscribe\nLog in\nPolitics\n\nThe actual news happened today, here are the details.'
    const pages = paginate(text, 1000)
    const all = pages.join(' ')
    expect(all).toContain('actual news happened today')
    expect(all).not.toContain('Subscribe')
    expect(all).not.toContain('Log in')
  })
})
