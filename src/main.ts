// Glance — read articles from your saved websites on Even Realities G2 glasses.
//
// Three-layer navigation:
//   1. SOURCES        — pick a saved site (ESPN, CNN, etc.)
//   2. ARTICLE LIST   — see headlines extracted from the site's homepage
//   3. READER         — paginated article body
//
// All extraction happens via r.jina.ai (free, CORS-open, headless-Chromium-backed).
// No backend infrastructure required.
//
// This file is intentionally a skeleton — full architecture lives in the
// PhilsHome ROADMAP.md "Plan: Glasses Web Reader" section. Implementation
// tasks 2-12 will fill this out.

import { connectEvenRuntime } from './even'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('App root missing')

root.innerHTML = `
  <main style="font-family: system-ui; padding: 1rem; max-width: 720px; margin: 0 auto; color: #232323;">
    <h1 style="margin: 0 0 .25rem 0;">Glance <span style="font-size: .6em; color: #7b7b7b;">v${__APP_VERSION__}</span></h1>
    <p style="color: #7b7b7b; margin: 0 0 1rem 0;">Read articles from your saved sites on Even G2 glasses.</p>
    <p id="status">Connecting to glasses...</p>
  </main>
`

const status = document.querySelector<HTMLParagraphElement>('#status')!

const initial = `Glance v${__APP_VERSION__}\n\nReady — sources picker coming next.`
const even = await connectEvenRuntime(initial)
if (!even) {
  status.textContent = 'Running outside the Even runtime — browser preview only.'
} else {
  status.textContent = 'Glasses connected.'
}
