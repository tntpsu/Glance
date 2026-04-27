// Paginate a long markdown body into ~400-char pages on word boundaries.
// Heuristic: prefer paragraph breaks, then sentence breaks, then word
// breaks. Hard-cap each page at PAGE_CAP chars to ensure it fits the
// 576x288 LVGL container after wrapping.
//
// The exact pixel-perfect width is undefined-by-firmware; 400 chars in
// the LVGL font fits comfortably on a full-screen container with 6px
// padding. Future iteration could tune via the font-measurement skill.

const PAGE_CAP = 400
const PAGE_MIN = 200 // don't break a page shorter than this if we can avoid it

// Lines that are page chrome — nav, footer, ad slots, video controls,
// "share" / "subscribe" prompts. r.jina.ai's headless extraction keeps
// these because they're real DOM text; we drop them post-fetch so they
// don't waste pagination budget on the glasses display.
const CHROME_LINE_PATTERNS: RegExp[] = [
  /^ad(vertisement)?( feedback)?$/i,
  /^sponsored( content| message)?$/i,
  // v0.5.2: CNN-style ad-feedback form (caught in real-world test against
  // a real CNN article — every CNN article body had this leaking through).
  /^.{1,30} values your feedback$/i,
  /^how (relevant|did|was|are)\b/i,
  /^did you (encounter|have|see|find)\b/i,
  /^\[x\]\s/i,                                  // checkbox option line "[x] No"
  /^(cancel|close|done|next|back|submit)( cancel| submit| close| done)?$/i,
  /^cancel\s+submit$/i,                         // "Cancel  Submit" footer of modal forms
  // v0.5.2: personal-area nav (CNN / Yahoo etc — "My Account / Settings /
  // Newsletters / Topics you follow")
  /^my account$/i,
  /^topics? you (follow|might like)$/i,
  /^newsletters?$/i,
  // v0.5.2: section pivots ("Trending X" — usually a short topic name
  // styled as a chip, not an article title)
  /^trending(\s\w+){1,3}$/i,
  /^stories for you$/i,
  /^streaming( now)?$/i,
  /^check these out$/i,
  /^for subscribers$/i,
  /^(more|other) top stories$/i,
  /^cnn underscored\b/i,
  /^crime and courts$/i,
  // v0.5.2: BBC News article-page footer
  /^add as preferred on google$/i,
  /^add (this )?(to|as)\s/i,
  // v0.5.2 round 3 (real CNN article test): post-form thank-you blurb,
  // social-follow CTAs, app-download CTAs, account-related prompts
  /^thank you!?$/i,
  /^your effort and contribution\b/i,
  /^follow (cnn|bbc|nyt|the|us)\b/i,
  /^download the .{1,30} app$/i,
  /^your .{1,20} account$/i,
  /^sign in to your .{1,20} account$/i,
  // v0.5.2: HN aggregator strip
  /^hacker news$/i,
  /^new \| past \| comments \|/i,
  // v0.5.2: concatenated nav like "DestinationsFood & DrinkNewsStayVideo"
  // — heuristic: 3+ capital-letter starts in a single word-ish line under 80 chars
  // (skip — false-positive risk too high; CNN-specific)
  /^show (more |all |full )?comments?$/i,
  /^view (\d+ )?comments?$/i,
  /^(\d+ )?comments?$/i,
  /^related (stories|articles|content|coverage|topics)/i,
  /^more (from|stories|on)\b/i,
  /^trending( now| stories| topics)?$/i,
  /^most (popular|read|viewed|shared)( stories| articles)?$/i,
  /^top (stories|news|headlines)$/i,
  /^breaking news$/i,
  /^live (updates|news|tv|coverage)$/i,
  /^video( player)?$/i,
  /^now playing\b/i,
  /^play video$/i,
  /^watch( now| video| live)?$/i,
  /^audio( player)?$/i,
  /^loading\.{0,3}$/i,
  /^subscribe( to (continue|read|now))?$/i,
  /^sign (in|up)( now)?$/i,
  /^log (in|out)( now)?$/i,
  /^create (a |an |your )?(free )?account$/i,
  /^skip to (main )?content$/i,
  /^skip to (navigation|nav)$/i,
  /^see (more|all)( stories| articles)?$/i,
  /^continue reading$/i,
  /^read (more|the full)( story| article)?$/i,
  /^share( this)?( article| story)?$/i,
  /^save( for later| article)?$/i,
  /^bookmark( this)?$/i,
  /^©.*$/,
  /^copyright\s/i,
  /^all rights reserved\.?$/i,
  /^updated\s+\d+\s+(min|hour|day|week)s?\s+ago$/i,
  /^posted\s+\d+\s+(min|hour|day|week)s?\s+ago$/i,
  /^(image|photo|video|illustration|getty( images)?|reuters|ap)( credit)?:?$/i,
  /^embed (from|via)\b/i,
  /^scroll to top$/i,
  /^back to top$/i,
  /^next( story| article| up)$/i,
  /^previous( story| article)$/i,
  /^story continues below$/i,
  /^advertisement$/i,
]

// Single-word lines that are almost always nav labels in news-site
// templates. Case-insensitive exact match on the trimmed line (after
// any bullet prefix is stripped — see isPageChrome).
const NAV_LINE_WORDS = new Set([
  'menu', 'home', 'world', 'us', 'u.s.', 'uk', 'politics', 'business', 'tech',
  'technology', 'sports', 'opinion', 'health', 'entertainment',
  'lifestyle', 'science', 'climate', 'economy', 'markets', 'travel',
  'food', 'food & drink', 'arts', 'culture', 'earth', 'media',
  'video', 'audio', 'podcasts', 'newsletters', 'newsletter',
  'live tv', 'live', 'subscribe', 'sign in', 'log in',
  'sign up', 'log out', 'about', 'contact', 'privacy', 'terms',
  'cookies', 'help', 'support', 'search', 'navigation',
  'archive', 'archives', 'sitemap', 'rss', 'feeds',
  // v0.5.2: more nav variants from real-world testing
  'destinations', 'stay', 'documentaries', 'in pictures', 'bbc indepth',
  'bbc verify', 'us & canada', 'asia', 'africa', 'australia', 'europe',
  'latin america', 'middle east', 'weather', 'settings', 'my account',
  'watch', 'listen', 'watchlistensubscribe', 'paginate', 'topics you follow',
  // Sub-nav single words common across news sites
  'crime', 'courts', 'breaking', 'latest', 'top stories',
  // v0.5.2 round 2 (real CNN+BBC test): singular nav forms + language
  // switcher + sign-out variants + section repeats
  'news', 'sport', 'more', 'sign out', 'edition', 'international',
  'arabic', 'español', 'french', 'german', 'spanish',
  'listenwatch', 'watchlisten', 'related', 'oil', 'fuel',
])

function isPageChrome(line: string): boolean {
  const t = line.trim()
  if (t.length === 0) return false // keep blank lines for paragraph spacing
  // v0.5.2: drop lines that are JUST one or more empty-text markdown links,
  // e.g. "[](https://www.bbc.com/)" or "[](url1)[](url2)" (CNN logo +
  // section anchor concatenated). These survive strip() because the
  // link regex requires non-empty link text. Render as empty/icon nav
  // anchors on the source page; nothing useful for the reader.
  if (/^(\[\]\([^)]+\)(\s+"[^"]*")?\s*)+$/.test(t)) return true
  // v0.5.2: empty bullet line (just "•" or "•   ") — happens when an
  // image link or bare anchor was the only content of a list item, and
  // strip() removed it leaving the bullet behind.
  if (/^[•\-*+]\s*$/.test(t)) return true
  // v0.5.2: form-control mega-line — 2+ [x] checkbox markers on the same
  // line strongly signals a feedback form rendered as inline options
  // (caught: CNN's "Video player was slow to load - [x] Video content
  // never loaded - [x] Ad froze - [x] ..." which was one giant line).
  const xboxMatches = t.match(/\[x\]/gi)
  if (xboxMatches && xboxMatches.length >= 2) return true
  // Strip BOTH leading bullet AND leading "N. " number prefix before
  // checking patterns + nav words. CNN's ad-feedback prompts come as
  // "1. How relevant is this ad to you?" — without stripping the "1. "
  // prefix, /^how /i never matches.
  const sansPrefix = t
    .replace(/^[•\-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
  if (CHROME_LINE_PATTERNS.some(p => p.test(sansPrefix))) return true
  if (NAV_LINE_WORDS.has(sansPrefix.toLowerCase())) return true
  // Also keep the original-line patterns for cases where the prefix IS
  // significant (the CHROME_LINE_PATTERNS list applied without stripping).
  if (CHROME_LINE_PATTERNS.some(p => p.test(t))) return true
  return false
}

// Strip markdown decorations + page chrome lines. The chrome filter runs
// AFTER markdown-to-text conversion so patterns match plaintext, not
// markup. Blank lines are preserved so paragraph spacing survives.
//
// Order matters for the markdown passes: bullets MUST be converted
// before the *_/_ stripping pass, since "* bullet" shares the asterisk
// character with the bold/italic markers and would otherwise be eaten
// before we recognize it as a bullet.
function strip(md: string): string {
  const decorationsStripped = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → just the link text
    .replace(/^#+\s*/gm, '') // headings → drop the # prefix
    .replace(/^>\s*/gm, '') // blockquote markers
    .replace(/^[-*+]\s+/gm, '• ') // bullets — must run BEFORE the * strip
    .replace(/(\*\*|__|\*|_|`)/g, '') // bold / italic / code marks

  // Drop chrome lines, then collapse runs of blank lines.
  const linesKept = decorationsStripped
    .split('\n')
    .filter(line => !isPageChrome(line))
    .join('\n')

  return linesKept
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const __test__ = { strip, isPageChrome }

export function paginate(rawMarkdown: string, capChars = PAGE_CAP): string[] {
  const text = strip(rawMarkdown)
  if (text.length === 0) return []
  if (text.length <= capChars) return [text]

  const pages: string[] = []
  let i = 0
  while (i < text.length) {
    const remaining = text.length - i
    if (remaining <= capChars) {
      pages.push(text.slice(i).trim())
      break
    }
    const end = i + capChars
    // Try paragraph break first.
    let cut = text.lastIndexOf('\n\n', end)
    if (cut < i + PAGE_MIN) cut = -1
    // Then sentence break.
    if (cut < 0) {
      cut = -1
      for (const punct of ['. ', '? ', '! ', '\n']) {
        const idx = text.lastIndexOf(punct, end)
        if (idx > cut && idx >= i + PAGE_MIN) cut = idx + punct.length
      }
    }
    // Then word break.
    if (cut < 0) {
      cut = text.lastIndexOf(' ', end)
      if (cut < i + PAGE_MIN) cut = end
    }
    pages.push(text.slice(i, cut).trim())
    i = cut
  }
  return pages.filter(p => p.length > 0)
}
