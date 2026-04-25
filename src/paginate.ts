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

// Strip markdown decorations that don't render well on the glasses font.
function strip(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → just the link text
    .replace(/^#+\s*/gm, '') // headings → drop the # prefix
    .replace(/^>\s*/gm, '') // blockquote markers
    .replace(/(\*\*|__|\*|_|`)/g, '') // bold / italic / code marks
    .replace(/^[-*+]\s+/gm, '• ') // bullets
    .replace(/\n{3,}/g, '\n\n') // collapse big gaps
    .trim()
}

export function paginate(rawMarkdown: string, capChars = PAGE_CAP): string[] {
  const text = strip(rawMarkdown)
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
