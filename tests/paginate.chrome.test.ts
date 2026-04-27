// Tests for the v0.5.1 page-chrome filter in paginate.strip(). The
// filter drops template noise (nav words, ad slots, "show comments")
// that r.jina.ai's headless extraction leaves in. Without it, CNN-like
// articles are mostly chrome.

import { describe, expect, it } from 'vitest'
import { paginate, __test__ } from '../src/paginate'

const { isPageChrome } = __test__

describe('isPageChrome', () => {
  it('drops "Ad feedback" and ad variants', () => {
    expect(isPageChrome('Ad feedback')).toBe(true)
    expect(isPageChrome('AD FEEDBACK')).toBe(true)
    expect(isPageChrome('Advertisement')).toBe(true)
    expect(isPageChrome('Sponsored content')).toBe(true)
  })
  it('drops nav words like "Politics" / "Live TV" / "U.S."', () => {
    expect(isPageChrome('Politics')).toBe(true)
    expect(isPageChrome('Live TV')).toBe(true)
    expect(isPageChrome('U.S.')).toBe(true)
    expect(isPageChrome('Business')).toBe(true)
    expect(isPageChrome('Sign In')).toBe(true)
  })
  it('drops "Show comments" / "Related stories" / "Most read" footers', () => {
    expect(isPageChrome('Show comments')).toBe(true)
    expect(isPageChrome('Show all comments')).toBe(true)
    expect(isPageChrome('Related stories')).toBe(true)
    expect(isPageChrome('Most read')).toBe(true)
    expect(isPageChrome('Most popular stories')).toBe(true)
  })
  it('drops video player / loading text', () => {
    expect(isPageChrome('Video')).toBe(true)
    expect(isPageChrome('Now playing')).toBe(true)
    expect(isPageChrome('Play video')).toBe(true)
    expect(isPageChrome('Loading...')).toBe(true)
    expect(isPageChrome('Loading')).toBe(true)
  })
  it('preserves real article content', () => {
    expect(isPageChrome('The first half of the announcement focused on the new pricing.')).toBe(false)
    expect(isPageChrome('Sources said that several executives raised concerns.')).toBe(false)
    expect(isPageChrome('"This is what we expected," she said.')).toBe(false)
  })
  it('preserves blank lines (paragraph spacing survives)', () => {
    expect(isPageChrome('')).toBe(false)
    expect(isPageChrome('   ')).toBe(false)
  })
  it('does NOT drop legitimate single-word title fragments', () => {
    // "Yes" or "No" lines in dialog excerpts shouldn't be misclassified.
    expect(isPageChrome('Yes.')).toBe(false)
    expect(isPageChrome('Indeed.')).toBe(false)
  })
})

describe('paginate strips page chrome end-to-end', () => {
  it('removes nav lines from a CNN-shaped sample', () => {
    const cnnSample = `# Article Title

Politics
World
US
Live TV

By Jane Reporter
Updated 2 minutes ago

The first half of the announcement focused on the new pricing model.

Ad feedback

The company said it would honor existing contracts.

Show comments
Related stories
Most read`
    const pages = paginate(cnnSample, 1000)
    const all = pages.join(' ')
    expect(all).toContain('first half of the announcement')
    expect(all).toContain('honor existing contracts')
    expect(all).not.toContain('Politics')
    expect(all).not.toContain('Live TV')
    expect(all).not.toContain('Ad feedback')
    expect(all).not.toContain('Show comments')
    expect(all).not.toContain('Related stories')
  })
})
