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
// templates. Case-insensitive exact match on the trimmed line.
const NAV_LINE_WORDS = new Set([
  'menu', 'home', 'world', 'us', 'u.s.', 'politics', 'business', 'tech',
  'technology', 'sports', 'opinion', 'health', 'entertainment',
  'lifestyle', 'science', 'climate', 'economy', 'markets', 'travel',
  'food', 'arts', 'media', 'video', 'audio', 'podcasts', 'newsletters',
  'newsletter', 'live tv', 'live', 'subscribe', 'sign in', 'log in',
  'sign up', 'log out', 'about', 'contact', 'privacy', 'terms',
  'cookies', 'help', 'support', 'search', 'menu', 'navigation',
  'archive', 'archives', 'sitemap', 'rss', 'feeds',
])

function isPageChrome(line: string): boolean {
  const t = line.trim()
  if (t.length === 0) return false // keep blank lines for paragraph spacing
  if (CHROME_LINE_PATTERNS.some(p => p.test(t))) return true
  if (NAV_LINE_WORDS.has(t.toLowerCase())) return true
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
