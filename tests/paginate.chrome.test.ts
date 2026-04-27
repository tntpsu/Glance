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

  // ─── v0.5.2 round 2 — caught by real-world test against CNN article ───
  it('drops bullet-prefixed nav (BBC menu items)', () => {
    expect(isPageChrome('• Home')).toBe(true)
    expect(isPageChrome('• News')).toBe(true)
    expect(isPageChrome('• Sport')).toBe(true)
    expect(isPageChrome('• Technology')).toBe(true)
    expect(isPageChrome('- Politics')).toBe(true)
    expect(isPageChrome('* Business')).toBe(true)
  })
  it('drops numbered form prompts (CNN ad-feedback)', () => {
    expect(isPageChrome('1. How relevant is this ad to you?')).toBe(true)
    expect(isPageChrome('2. Did you encounter any technical issues?')).toBe(true)
    expect(isPageChrome('3. How was the ad placement?')).toBe(true)
  })
  it('drops empty-text markdown anchor lines', () => {
    expect(isPageChrome('[](https://www.bbc.com/)')).toBe(true)
    // CNN had two concatenated logos on one line
    expect(isPageChrome('[](https://www.cnn.com/ "CNN logo")[](https://www.cnn.com/travel)')).toBe(true)
  })
  it('drops empty bullet lines (orphan list markers)', () => {
    expect(isPageChrome('•')).toBe(true)
    expect(isPageChrome('•   ')).toBe(true)
    expect(isPageChrome('-')).toBe(true)
    expect(isPageChrome('+')).toBe(true)
  })
  it('drops checkbox-form mega-lines (multi [x] markers)', () => {
    expect(isPageChrome('Video player was slow - [x] Video never loaded - [x] Ad froze - [x] Other')).toBe(true)
    expect(isPageChrome('[x] Yes [x] No')).toBe(true)
    // Single [x] in real content (e.g. code) should NOT trigger
    expect(isPageChrome('She marked [x] then walked away.')).toBe(false)
  })
  it('drops post-form thank-you blurbs', () => {
    expect(isPageChrome('Thank You!')).toBe(true)
    expect(isPageChrome('thank you')).toBe(true)
    expect(isPageChrome('Your effort and contribution in providing this feedback is much appreciated.')).toBe(true)
  })
  it('drops social-follow + app-download CTAs', () => {
    expect(isPageChrome('Follow CNN Travel')).toBe(true)
    expect(isPageChrome('Follow BBC News')).toBe(true)
    expect(isPageChrome('Download the CNN App')).toBe(true)
    expect(isPageChrome('Download the New York Times App')).toBe(true)
  })
  it('drops account-prompt lines', () => {
    expect(isPageChrome('Your CNN account')).toBe(true)
    expect(isPageChrome('Sign in to your CNN account')).toBe(true)
    expect(isPageChrome('My account')).toBe(true)
  })
  it('drops section pivots / "trending" topic chips', () => {
    expect(isPageChrome('Trending Iran')).toBe(true)
    expect(isPageChrome('Trending Kentucky Derby')).toBe(true)
    expect(isPageChrome('Stories for you')).toBe(true)
    expect(isPageChrome('Streaming Now')).toBe(true)
    expect(isPageChrome('CNN Underscored Mother\'s Day gifts')).toBe(true)
    expect(isPageChrome('More top stories')).toBe(true)
  })
  it('preserves real article content with similar shape', () => {
    // These look chrome-shaped at a glance but are real prose
    expect(isPageChrome('Iran said Monday that talks would resume.')).toBe(false)
    expect(isPageChrome('She said: "Please follow up next week."')).toBe(false)
    // Legitimate "1. X" enumerations in articles — note these slip
    // through filter (we strip "1. " before pattern check) but the
    // content "There are three reasons" is clearly real, not a form
    // prompt. Acceptable trade-off — form prompts are short/template-y.
    expect(isPageChrome('1. There are three main reasons this happened.')).toBe(false)
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
