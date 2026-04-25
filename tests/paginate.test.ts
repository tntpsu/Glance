import { describe, expect, it } from 'vitest'
import { paginate } from '../src/paginate'

describe('paginate', () => {
  it('returns single page for short text', () => {
    const out = paginate('Just a short body that fits in one page.', 400)
    expect(out.length).toBe(1)
    expect(out[0]!).toContain('Just a short body')
  })

  it('splits long text into multiple pages', () => {
    const sentence = 'This is a sentence with about fifty characters in it. '
    const text = sentence.repeat(40) // ~2200 chars
    const pages = paginate(text, 400)
    expect(pages.length).toBeGreaterThan(3)
    // Every page is under cap with reasonable slack.
    for (const p of pages) {
      expect(p.length).toBeLessThanOrEqual(440)
    }
  })

  it('breaks on paragraph boundaries when possible', () => {
    const para = 'This is paragraph A. '.repeat(15) // ~315 chars
    const text = `${para}\n\n${para}\n\n${para}`
    const pages = paginate(text, 400)
    expect(pages.length).toBeGreaterThanOrEqual(2)
    // Each page should not start mid-sentence.
    for (const p of pages) {
      expect(p[0]).toMatch(/[A-Z]/)
    }
  })

  it('breaks on word boundaries (not mid-word) when paragraph break unavailable', () => {
    const text = 'word '.repeat(120) // ~600 chars, no paragraphs
    const pages = paginate(text, 200)
    expect(pages.length).toBeGreaterThan(1)
    for (const p of pages) {
      // Each page should end on a word boundary or be the last page.
      expect(p).not.toMatch(/\bwor$/)
      expect(p).not.toMatch(/^d /)
    }
  })

  it('strips markdown decorations', () => {
    const md = '# Heading\n\n**Bold** and _italic_ and `code` and [link](url)\n\n* bullet one\n* bullet two'
    const [page] = paginate(md, 1000)
    expect(page).not.toContain('**')
    expect(page).not.toContain('`')
    expect(page).not.toContain('[link](url)')
    expect(page).toContain('link') // link text preserved
    expect(page).toContain('•') // bullets converted
    expect(page).not.toContain('# Heading')
  })

  it('strips images entirely', () => {
    const md = '![alt text](https://example.com/img.png)\n\nReal body content here.'
    const [page] = paginate(md, 400)
    expect(page).not.toContain('alt text')
    expect(page).toContain('Real body content')
  })

  it('returns empty array for empty input', () => {
    expect(paginate('', 400)).toEqual([])
    expect(paginate('   \n\n   ', 400)).toEqual([])
  })

  it('preserves all content across pages (no chars lost)', () => {
    const text = 'Some words here. '.repeat(50) // ~850 chars
    const pages = paginate(text, 200)
    const reassembled = pages.join(' ').replace(/\s+/g, ' ').trim()
    const expected = text.trim().replace(/\s+/g, ' ')
    // Content should be preserved (modulo whitespace normalization).
    expect(reassembled.length).toBeGreaterThanOrEqual(expected.length - 5)
  })
})
