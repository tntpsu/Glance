// Glance entry point. Three-layer navigation (sources → article list →
// reader) wired through the openPicker modal for selection at each layer.
//
// Phone-side settings UI is rendered into #app — visible when the user
// opens the plugin in the Even Hub companion app on the phone (before
// putting glasses on). The glasses-side display is driven via the
// EvenRuntime returned from connectEvenRuntime.

import { ESPN_LEAGUES } from './adapters/espn'
import { addInboxItem, setInboxBridge } from './adapters/inbox'
import { getAdapter } from './adapters/index'
import { setDefaultWorkerCache } from './adapters/jina'
import { makeGenerationCounter } from './inflight'
import { connectEvenRuntime, type EvenRuntime, type InputSource } from './even'
import { JinaError, setJinaApiKeyCache, setJinaLogger, type JinaFetchLog } from './jina'
import { paginate } from './paginate'
import { DEFAULT_SOURCES, looksLikeUrl, makeSource } from './sources'
import {
  clearDefaultWorker,
  clearPendingOpen,
  getCachedBody,
  getDefaultWorker,
  getJinaApiKey,
  getPendingOpen,
  getScrollMode,
  loadReadUrls,
  loadState,
  markRead,
  putCachedBody,
  saveState,
  setDefaultWorker,
  setJinaApiKey,
  setPendingOpen,
  setScrollMode,
  setStorageBridge,
  type ScrollMode,
} from './storage'
import type { Article, ReaderState, Source } from './types'

// --- module-level state ---

let state: ReaderState = { sources: [] }
let articleListCache = new Map<
  string,
  { articles: Article[]; fetchedAt: number; sourceUrl: string }
>()
const ARTICLE_LIST_TTL_MS = 5 * 60_000

let view: 'sources' | 'articles' | 'reader' = 'sources'
let currentSource: Source | null = null
let currentArticles: Article[] = []
let currentArticle: Article | null = null
let currentPages: string[] = []
let currentPageIndex = 0

// Cursor positions for the swipe-driven list views. Tap opens whatever
// the cursor is on. Tracking these separately from "current" state means
// scrolling and committing are decoupled cleanly.
let sourceCursor = 0
let articleCursor = 0

// Scroll mode — 'page' (default, ~400 chars per swipe) or 'line'
// (~100 chars, smaller jump per swipe). Hydrated from storage in
// bootstrap; updated when the settings toggle fires.
let scrollMode: ScrollMode = 'page'

// Measured via @evenrealities/pretext (font-measurement skill) against a
// 564px-inner-width container, line-height 27px, max 10 lines/page:
//   400 chars → 8 lines (~80% of screen — page mode)
//   100 chars → 2 lines (~20% of screen — line mode sweet spot)
//    80 chars → also 2 lines (line mode lower-end variation)
//    60 chars → 1 line (would feel jerky — too small)
const PAGE_CAP = 400
const LINE_CAP = 100

function paginateForMode(body: string): string[] {
  return paginate(body, scrollMode === 'line' ? LINE_CAP : PAGE_CAP)
}

// Phone-side fetch debug log. Kept in-memory only — refreshing the page
// clears it. Capped so a long session doesn't grow unbounded.
const FETCH_LOG_CAP = 50
const fetchLog: JinaFetchLog[] = []
function pushFetchLog(entry: JinaFetchLog): void {
  fetchLog.unshift(entry)
  if (fetchLog.length > FETCH_LOG_CAP) fetchLog.length = FETCH_LOG_CAP
  renderFetchLog()
}

function fmtAgo(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  return `${Math.round(sec / 3600)}h ago`
}

function renderFetchLog(): void {
  if (!fetchLogEl) return
  if (fetchLog.length === 0) {
    fetchLogEl.innerHTML = '<div style="color: #7b7b7b;">No fetches yet — try opening a source on the glasses.</div>'
    return
  }
  fetchLogEl.innerHTML = fetchLog
    .map(e => {
      const statusBadge = e.ok
        ? `<span style="color: #2a2;">${e.status ?? '?'}</span>`
        : `<span style="color: #c00;">${e.status ?? 'NET'}</span>`
      const ms = `${e.ms}ms`
      const bytes = e.bytes !== undefined ? ` ${(e.bytes / 1024).toFixed(1)}KB` : ''
      const err = e.error ? `<div style="color: #c00; margin-top: .15rem;">↳ ${escapeHtml(e.error)}</div>` : ''
      const url = e.url.length > 70 ? `${e.url.slice(0, 67)}…` : e.url
      return `<div style="padding: .35rem 0; border-bottom: 1px solid #f0f0f0;">
        <div style="display: flex; gap: .5rem; align-items: center;">
          <span style="color: #999; min-width: 6em;">${fmtAgo(e.ts)}</span>
          ${statusBadge}
          <span style="color: #555;">${ms}${bytes}</span>
        </div>
        <div style="color: #232323; word-break: break-all;">${escapeHtml(url)}</div>
        ${err}
      </div>`
    })
    .join('')
}

// Sliding-window size for both list views — fits the right-column with
// header + cursor + 5 visible items + hint footer comfortably.
const VISIBLE_ROWS = 5

// Set of article URLs the user has read to completion. Hydrated on
// boot, mutated as we mark articles read; persists via storage.markRead.
let readUrls: Set<string> = new Set()

// --- DOM scaffold (phone-side settings UI) ---

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('App root missing')

root.innerHTML = `
  <main style="font-family: system-ui; padding: 1rem; max-width: 720px; margin: 0 auto; color: #232323;">
    <h1 style="margin: 0 0 .25rem 0;">Glance <span style="font-size: .55em; color: #7b7b7b; font-weight: 400;">v${__APP_VERSION__}</span></h1>
    <p style="color: #7b7b7b; margin: 0 0 1.5rem 0;">Read articles from your saved sites on Even G2 glasses.</p>

    <p id="status" style="margin: 0 0 1rem 0;">Connecting…</p>

    <section>
      <h2 style="font-size: 1.1em; margin: 1.25rem 0 .5rem 0;">Save an article (Inbox)</h2>
      <p style="color: #7b7b7b; margin: 0 0 .5rem 0; font-size: .9em;">
        Paste any article URL — Glance will queue it under "★ Saved articles" on the glasses.
        Pro tip: copy a URL from any app's share sheet, then come back here and paste it below.
      </p>
      <form id="add-inbox-form" style="display: grid; gap: .25rem; max-width: 480px; margin-bottom: 1rem;">
        <label>Article URL <input id="inbox-url" type="url" required placeholder="https://example.com/article" style="padding: .35rem; width: 100%; box-sizing: border-box;" /></label>
        <label>Title <span style="color: #7b7b7b; font-size: .85em;">(optional — derived from URL if empty)</span> <input id="inbox-title" type="text" style="padding: .35rem; width: 100%; box-sizing: border-box;" /></label>
        <div style="display: flex; gap: .5rem; margin-top: .25rem; flex-wrap: wrap;">
          <button type="submit" style="padding: .4rem .8rem; cursor: pointer;">Save to inbox</button>
          <button type="button" id="save-and-open" style="padding: .4rem .8rem; cursor: pointer; background: #232323; color: #fff;">Save &amp; open on glasses</button>
          <button type="button" id="paste-clipboard" style="padding: .4rem .8rem; cursor: pointer; background: #eee;">Paste from clipboard</button>
        </div>
        <p id="inbox-status" style="color: #2a2; margin: .25rem 0 0 0; font-size: .85em; min-height: 1.2em;"></p>
      </form>
    </section>

    <section>
      <h2 style="font-size: 1.1em; margin: 0 0 .5rem 0;">Sources</h2>
      <ul id="sources-list" style="list-style: none; padding: 0; margin: 0 0 1rem 0;"></ul>

      <details style="margin-bottom: 1rem;">
        <summary style="cursor: pointer; color: #232323;">Add a generic source (any homepage URL)</summary>
        <form id="add-source-form" style="margin-top: .5rem; display: grid; gap: .25rem; max-width: 480px;">
          <label>Title <input id="src-title" type="text" required style="padding: .35rem; width: 100%; box-sizing: border-box;" /></label>
          <label>URL <input id="src-url" type="url" required placeholder="https://example.com" style="padding: .35rem; width: 100%; box-sizing: border-box;" /></label>
          <button type="submit" style="margin-top: .25rem; padding: .4rem .8rem; cursor: pointer; max-width: 120px;">Add</button>
          <p id="add-error" style="color: #c00; margin: .25rem 0 0 0; font-size: .85em;"></p>
        </form>
      </details>

      <details style="margin-bottom: 1rem;">
        <summary style="cursor: pointer; color: #232323;">Add an ESPN league source (uses ESPN's news API)</summary>
        <form id="add-espn-form" style="margin-top: .5rem; display: grid; gap: .25rem; max-width: 480px;">
          <label>League
            <select id="espn-league" style="padding: .35rem; width: 100%; box-sizing: border-box;">
              ${ESPN_LEAGUES.map(l => `<option value="${l.slug}">${escapeHtml(l.label)}</option>`).join('')}
            </select>
          </label>
          <button type="submit" style="margin-top: .25rem; padding: .4rem .8rem; cursor: pointer; max-width: 200px;">Add ESPN source</button>
          <p id="add-espn-status" style="color: #2a2; margin: .25rem 0 0 0; font-size: .85em; min-height: 1.2em;"></p>
        </form>
      </details>

      <details style="margin-bottom: 1rem;">
        <summary style="cursor: pointer; color: #232323;">Add a worker source (auth-walled sites)</summary>
        <p style="color: #7b7b7b; margin: .5rem 0; font-size: .85em;">
          For sites that need login (Rivals, NYT-with-account, paid forums).
          Deploy the Cloudflare Worker template at
          <code>worker-template/</code> in this repo first, then paste the
          Worker URL + bearer token here. Full setup steps in
          <code>worker-template/README.md</code>.
        </p>
        <form id="add-worker-form" style="margin-top: .5rem; display: grid; gap: .25rem; max-width: 480px;">
          <label>Title <input id="worker-title" type="text" required placeholder="BWI Rivals" style="padding: .35rem; width: 100%; box-sizing: border-box;" /></label>
          <label>Site homepage URL <input id="worker-site-url" type="url" required placeholder="https://bwi.rivals.com" style="padding: .35rem; width: 100%; box-sizing: border-box;" /></label>
          <label>Worker URL <input id="worker-url" type="url" required placeholder="https://glance-reader.your-sub.workers.dev" style="padding: .35rem; width: 100%; box-sizing: border-box;" /></label>
          <label>Bearer token <input id="worker-token" type="password" required placeholder="(your SHARED_SECRET)" style="padding: .35rem; width: 100%; box-sizing: border-box; font-family: monospace;" /></label>
          <button type="submit" style="margin-top: .25rem; padding: .4rem .8rem; cursor: pointer; max-width: 220px;">Add worker source</button>
          <p id="add-worker-status" style="color: #2a2; margin: .25rem 0 0 0; font-size: .85em; min-height: 1.2em;"></p>
        </form>
      </details>

      <button id="reset-defaults" style="padding: .35rem .7rem; cursor: pointer; font-size: .85em; color: #7b7b7b;">Reset to default sources</button>
    </section>

    <section style="margin-top: 2rem;">
      <h2 style="font-size: 1.1em; margin: 0 0 .5rem 0;">Reading mode</h2>
      <p style="color: #7b7b7b; margin: 0 0 .5rem 0; font-size: .9em;">
        How much text each swipe advances. Page = whole screen at once. Line = smaller chunks for closer-to-continuous reading.
      </p>
      <div style="display: flex; gap: 1rem; max-width: 480px;">
        <label style="display: flex; align-items: center; gap: .35rem; cursor: pointer;">
          <input type="radio" name="scroll-mode" value="page" /> Page-by-page
        </label>
        <label style="display: flex; align-items: center; gap: .35rem; cursor: pointer;">
          <input type="radio" name="scroll-mode" value="line" /> Line-by-line
        </label>
      </div>
      <p id="scroll-mode-status" style="color: #2a2; font-size: .85em; min-height: 1.2em; margin: .25rem 0 0 0;"></p>
    </section>

    <section style="margin-top: 2rem;">
      <details>
        <summary style="cursor: pointer; color: #232323;">Default Worker (optional — universal extractor)</summary>
        <p style="color: #7b7b7b; margin: .5rem 0; font-size: .85em; max-width: 520px;">
          Glance reads articles via <code>r.jina.ai</code> by default — free, no setup. The free tier has cold starts up to ~25s on
          unfamiliar sites and rate-limits per IP. If you've deployed the Cloudflare Worker template at <code>worker-template/</code>,
          paste its URL + bearer token here and Glance will try your Worker FIRST for every article body, falling back to r.jina.ai
          only if your Worker is unreachable. Faster, no rate limits, and no third-party seeing your reading list.
        </p>
        <form id="default-worker-form" style="display: grid; gap: .25rem; max-width: 480px;">
          <label>Worker URL <input id="default-worker-url" type="url" placeholder="https://glance-reader.your-sub.workers.dev" style="padding: .35rem; width: 100%; box-sizing: border-box;" /></label>
          <label>Bearer token <input id="default-worker-token" type="password" placeholder="(your SHARED_SECRET)" style="padding: .35rem; width: 100%; box-sizing: border-box; font-family: monospace;" /></label>
          <div style="display: flex; gap: .5rem; margin-top: .25rem;">
            <button type="submit" style="padding: .35rem .7rem; cursor: pointer;">Save</button>
            <button type="button" id="default-worker-clear" style="padding: .35rem .7rem; cursor: pointer; background: #eee;">Clear</button>
          </div>
          <p id="default-worker-status" style="color: #2a2; margin: .25rem 0 0 0; font-size: .85em; min-height: 1.2em;"></p>
        </form>
      </details>

      <details>
        <summary style="cursor: pointer; color: #7b7b7b;">Advanced — Jina API key (optional)</summary>
        <p style="color: #7b7b7b; margin: .5rem 0; font-size: .85em;">
          Glance uses the free public r.jina.ai service to extract article text.
          The free tier is rate-limited per IP per domain (you'll see "Rate-limited
          by Jina" errors when over the cap). A paid Jina API key bypasses the
          limit. Get one at <a href="https://jina.ai/reader/" target="_blank" rel="noopener">jina.ai/reader</a>.
          Stored locally on this device only — never sent anywhere except r.jina.ai.
        </p>
        <form id="jina-key-form" style="display: grid; gap: .25rem; max-width: 480px;">
          <label>API key <input id="jina-key-input" type="password" placeholder="jina_xxxxxxxxxxxx" style="padding: .35rem; width: 100%; box-sizing: border-box; font-family: monospace;" /></label>
          <div style="display: flex; gap: .5rem; margin-top: .25rem;">
            <button type="submit" style="padding: .35rem .7rem; cursor: pointer;">Save</button>
            <button type="button" id="jina-key-clear" style="padding: .35rem .7rem; cursor: pointer; background: #eee;">Clear</button>
          </div>
          <p id="jina-key-status" style="color: #2a2; margin: .25rem 0 0 0; font-size: .85em; min-height: 1.2em;"></p>
        </form>
      </details>
    </section>

    <section style="margin-top: 2rem;">
      <details>
        <summary style="cursor: pointer; color: #232323;">Recent fetches (debug)</summary>
        <p style="color: #7b7b7b; margin: .5rem 0; font-size: .85em; max-width: 520px;">
          Last 50 article-body / homepage fetches with status, latency, and any error
          message. Use this to figure out why a source is misbehaving — 451 = legal
          block, 403 = bot wall, 429 = rate limited, timeout = r.jina.ai cold start.
        </p>
        <div style="display: flex; gap: .5rem; margin-bottom: .5rem;">
          <button id="fetch-log-clear" type="button" style="padding: .35rem .7rem; cursor: pointer; background: #eee;">Clear</button>
          <button id="fetch-log-refresh" type="button" style="padding: .35rem .7rem; cursor: pointer; background: #eee;">Refresh</button>
        </div>
        <div id="fetch-log" style="max-width: 720px; max-height: 320px; overflow-y: auto; font-family: ui-monospace, monospace; font-size: .8em; border: 1px solid #ddd; padding: .5rem;"></div>
      </details>
    </section>

    <section style="margin-top: 2rem; color: #7b7b7b; font-size: .85em;">
      <h3 style="font-size: 1em; margin: 0 0 .5rem 0;">How to use</h3>
      <ol style="padding-left: 1.25rem; line-height: 1.5;">
        <li>Put on the glasses and open Glance from the Even Hub launcher.</li>
        <li>Pick a source from the list — the app fetches its current articles via r.jina.ai.</li>
        <li>Tap a headline to read the article body, paginated. Swipe up/down to flip pages.</li>
        <li>Double-tap to go back a layer.</li>
      </ol>
    </section>
  </main>
`

const status = document.querySelector<HTMLParagraphElement>('#status')!
const sourcesList = document.querySelector<HTMLUListElement>('#sources-list')!
const addForm = document.querySelector<HTMLFormElement>('#add-source-form')!
const titleInput = document.querySelector<HTMLInputElement>('#src-title')!
const urlInput = document.querySelector<HTMLInputElement>('#src-url')!
const addError = document.querySelector<HTMLParagraphElement>('#add-error')!
const resetBtn = document.querySelector<HTMLButtonElement>('#reset-defaults')!

function renderSourcesList(): void {
  if (state.sources.length === 0) {
    sourcesList.innerHTML = '<li style="color: #7b7b7b; font-style: italic;">No sources yet — add one or reset to defaults.</li>'
    return
  }
  sourcesList.innerHTML = state.sources
    .map(
      s => `
      <li style="display: flex; justify-content: space-between; align-items: center; padding: .4rem .5rem; background: #eee; border-radius: 4px; margin-bottom: .35rem;">
        <span>
          <strong>${escapeHtml(s.title)}</strong>
          <span style="color: #7b7b7b; font-size: .85em; margin-left: .5rem;">${escapeHtml(s.url)}</span>
        </span>
        <button data-id="${s.id}" class="remove-source" style="border: none; background: transparent; color: #c00; cursor: pointer; font-size: 1.2em;" title="Remove">×</button>
      </li>
    `,
    )
    .join('')
  sourcesList.querySelectorAll<HTMLButtonElement>('.remove-source').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset['id']
      if (!id) return
      state.sources = state.sources.filter(s => s.id !== id)
      await saveState(state)
      renderSourcesList()
    })
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

addForm.addEventListener('submit', async e => {
  e.preventDefault()
  addError.textContent = ''
  const title = titleInput.value.trim()
  const url = urlInput.value.trim()
  if (!title) {
    addError.textContent = 'Title required.'
    return
  }
  if (!looksLikeUrl(url)) {
    addError.textContent = 'URL must be a valid http(s) URL.'
    return
  }
  state.sources.push(makeSource(title, url))
  await saveState(state)
  titleInput.value = ''
  urlInput.value = ''
  renderSourcesList()
})

resetBtn.addEventListener('click', async () => {
  if (!confirm('Replace your current sources with the curated defaults?')) return
  state.sources = [...DEFAULT_SOURCES]
  await saveState(state)
  renderSourcesList()
})

// --- ESPN league source add ---

const espnForm = document.querySelector<HTMLFormElement>('#add-espn-form')!
const espnLeagueSelect = document.querySelector<HTMLSelectElement>('#espn-league')!
const espnStatus = document.querySelector<HTMLParagraphElement>('#add-espn-status')!

espnForm.addEventListener('submit', async e => {
  e.preventDefault()
  const slug = espnLeagueSelect.value
  const league = ESPN_LEAGUES.find(l => l.slug === slug)
  if (!league) return
  // Avoid duplicates — ESPN sources are uniquely identified by their slug.
  const existing = state.sources.find(
    s => s.adapter === 'espn-news' && s.adapterConfig?.league === slug,
  )
  if (existing) {
    espnStatus.style.color = '#c00'
    espnStatus.textContent = `${league.label} is already in your sources.`
    return
  }
  state.sources.push({
    id: `src_${Date.now()}_espn_${slug.replace(/\W+/g, '_')}`,
    title: `ESPN — ${league.label}`,
    url: `espn-news://${slug}`,
    adapter: 'espn-news',
    adapterConfig: { league: slug },
  })
  await saveState(state)
  renderSourcesList()
  espnStatus.style.color = '#2a2'
  espnStatus.textContent = `Added ESPN — ${league.label}.`
  window.setTimeout(() => { espnStatus.textContent = '' }, 3000)
})

// --- Worker source add ---

const workerForm = document.querySelector<HTMLFormElement>('#add-worker-form')!
const workerTitleInput = document.querySelector<HTMLInputElement>('#worker-title')!
const workerSiteUrlInput = document.querySelector<HTMLInputElement>('#worker-site-url')!
const workerUrlInput = document.querySelector<HTMLInputElement>('#worker-url')!
const workerTokenInput = document.querySelector<HTMLInputElement>('#worker-token')!
const workerStatus = document.querySelector<HTMLParagraphElement>('#add-worker-status')!

workerForm.addEventListener('submit', async e => {
  e.preventDefault()
  const title = workerTitleInput.value.trim()
  const siteUrl = workerSiteUrlInput.value.trim()
  const workerUrl = workerUrlInput.value.trim()
  const token = workerTokenInput.value.trim()
  if (!title) {
    workerStatus.style.color = '#c00'
    workerStatus.textContent = 'Title required.'
    return
  }
  if (!looksLikeUrl(siteUrl) || !looksLikeUrl(workerUrl)) {
    workerStatus.style.color = '#c00'
    workerStatus.textContent = 'Site URL and Worker URL must both be valid http(s) URLs.'
    return
  }
  if (!token) {
    workerStatus.style.color = '#c00'
    workerStatus.textContent = 'Bearer token required.'
    return
  }
  state.sources.push({
    id: `src_${Date.now()}_worker`,
    title,
    url: siteUrl,
    adapter: 'worker',
    adapterConfig: { workerUrl, bearerToken: token },
  })
  await saveState(state)
  renderSourcesList()
  workerTitleInput.value = ''
  workerSiteUrlInput.value = ''
  workerUrlInput.value = ''
  workerTokenInput.value = ''
  workerStatus.style.color = '#2a2'
  workerStatus.textContent = `Added "${title}" via worker.`
  window.setTimeout(() => { workerStatus.textContent = '' }, 3000)
})

// --- inbox add form ---

const inboxForm = document.querySelector<HTMLFormElement>('#add-inbox-form')!
const inboxUrlInput = document.querySelector<HTMLInputElement>('#inbox-url')!
const inboxTitleInput = document.querySelector<HTMLInputElement>('#inbox-title')!
const inboxStatus = document.querySelector<HTMLParagraphElement>('#inbox-status')!
const pasteBtn = document.querySelector<HTMLButtonElement>('#paste-clipboard')!
const saveAndOpenBtn = document.querySelector<HTMLButtonElement>('#save-and-open')!
const defaultWorkerForm = document.querySelector<HTMLFormElement>('#default-worker-form')!
const defaultWorkerUrlInput = document.querySelector<HTMLInputElement>('#default-worker-url')!
const defaultWorkerTokenInput = document.querySelector<HTMLInputElement>('#default-worker-token')!
const defaultWorkerClearBtn = document.querySelector<HTMLButtonElement>('#default-worker-clear')!
const defaultWorkerStatus = document.querySelector<HTMLParagraphElement>('#default-worker-status')!
const scrollModeStatus = document.querySelector<HTMLParagraphElement>('#scroll-mode-status')!
const fetchLogEl = document.querySelector<HTMLDivElement>('#fetch-log')!
const fetchLogClearBtn = document.querySelector<HTMLButtonElement>('#fetch-log-clear')!
const fetchLogRefreshBtn = document.querySelector<HTMLButtonElement>('#fetch-log-refresh')!

fetchLogClearBtn.addEventListener('click', () => {
  fetchLog.length = 0
  renderFetchLog()
})
fetchLogRefreshBtn.addEventListener('click', () => renderFetchLog())

async function addInboxFromForm(url: string, title: string): Promise<void> {
  if (!looksLikeUrl(url)) {
    inboxStatus.style.color = '#c00'
    inboxStatus.textContent = 'URL must be a valid http(s) URL.'
    return
  }
  const item = await addInboxItem(url, title)
  inboxStatus.style.color = '#2a2'
  inboxStatus.textContent = `Saved: ${item.title.slice(0, 60)}`
  inboxUrlInput.value = ''
  inboxTitleInput.value = ''
  // Clear status after 4s so it doesn't linger.
  window.setTimeout(() => {
    inboxStatus.textContent = ''
  }, 4000)
}

inboxForm.addEventListener('submit', e => {
  e.preventDefault()
  void addInboxFromForm(inboxUrlInput.value.trim(), inboxTitleInput.value.trim())
})

// "Save & open on glasses" — the closest thing we have to ER Browser's
// one-step "type URL → read" flow. Adds to inbox AND sets pendingOpen
// so the glasses-side bootstrap/foreground handler navigates straight
// into the article without the user having to find it in the inbox list.
saveAndOpenBtn.addEventListener('click', async () => {
  const url = inboxUrlInput.value.trim()
  const title = inboxTitleInput.value.trim()
  if (!looksLikeUrl(url)) {
    inboxStatus.style.color = '#c00'
    inboxStatus.textContent = 'URL must be a valid http(s) URL.'
    return
  }
  await addInboxItem(url, title)
  await setPendingOpen(url)
  inboxStatus.style.color = '#2a2'
  inboxStatus.textContent = 'Saved. Put on your glasses to read it now.'
  inboxUrlInput.value = ''
  inboxTitleInput.value = ''
  window.setTimeout(() => { inboxStatus.textContent = '' }, 5000)
})

// --- default Worker form ---

defaultWorkerForm.addEventListener('submit', async e => {
  e.preventDefault()
  const url = defaultWorkerUrlInput.value.trim()
  const token = defaultWorkerTokenInput.value.trim()
  if (!url || !token) {
    defaultWorkerStatus.style.color = '#c00'
    defaultWorkerStatus.textContent = 'Both URL and bearer token are required.'
    return
  }
  await setDefaultWorker(url, token)
  setDefaultWorkerCache({ workerUrl: url, bearerToken: token })
  defaultWorkerStatus.style.color = '#2a2'
  defaultWorkerStatus.textContent = 'Saved. Articles now use your Worker first.'
  window.setTimeout(() => { defaultWorkerStatus.textContent = '' }, 4000)
})

defaultWorkerClearBtn.addEventListener('click', async () => {
  await clearDefaultWorker()
  setDefaultWorkerCache(null)
  defaultWorkerUrlInput.value = ''
  defaultWorkerTokenInput.value = ''
  defaultWorkerStatus.style.color = '#2a2'
  defaultWorkerStatus.textContent = 'Cleared. Articles use r.jina.ai again.'
  window.setTimeout(() => { defaultWorkerStatus.textContent = '' }, 4000)
})

// --- scroll mode toggle ---

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="scroll-mode"]')) {
  radio.addEventListener('change', async () => {
    const value = radio.value === 'line' ? 'line' : 'page'
    scrollMode = value
    await setScrollMode(value)
    scrollModeStatus.style.color = '#2a2'
    scrollModeStatus.textContent = value === 'line'
      ? 'Line-by-line. Each swipe advances about one line.'
      : 'Page-by-page. Each swipe advances a full screen.'
    window.setTimeout(() => { scrollModeStatus.textContent = '' }, 4000)
    // If the user is mid-article, re-paginate so the new mode takes
    // effect immediately. Their page index resets to 0 (no clean way
    // to map old-cap pages → new-cap pages mid-article).
    if (currentPages.length > 0 && currentArticle) {
      const cached = await getCachedBody(currentArticle.url)
      if (cached) {
        currentPages = paginateForMode(cached.body)
        currentPageIndex = 0
        await paint()
      }
    }
  })
}

// --- Jina API key form ---

const jinaKeyForm = document.querySelector<HTMLFormElement>('#jina-key-form')!
const jinaKeyInput = document.querySelector<HTMLInputElement>('#jina-key-input')!
const jinaKeyClear = document.querySelector<HTMLButtonElement>('#jina-key-clear')!
const jinaKeyStatus = document.querySelector<HTMLParagraphElement>('#jina-key-status')!

jinaKeyForm.addEventListener('submit', async e => {
  e.preventDefault()
  const k = jinaKeyInput.value.trim()
  await setJinaApiKey(k)
  setJinaApiKeyCache(k || null)
  jinaKeyStatus.style.color = '#2a2'
  jinaKeyStatus.textContent = k ? 'Saved. Higher rate limit active.' : 'Cleared.'
  window.setTimeout(() => { jinaKeyStatus.textContent = '' }, 3000)
})

// --- clipboard auto-detect on focus ---
//
// Standard share-sheet flow: user copies a URL anywhere on their phone
// (Safari, Twitter, mail link, anywhere) → opens the Even Hub companion app
// → opens Glance. We detect a URL on the clipboard and offer one-tap save.
// Honors a "GLANCE:" prefix from the optional iOS Shortcut (see README) so
// the prompt only appears for URLs deliberately sent to Glance, not every
// random URL the user has copied.
//
// State: track the last URL we offered so we don't re-prompt on every focus
// event for the same one (window.focus fires often during normal use).
let lastOfferedClipboardUrl: string | null = null

async function checkClipboardForSavedUrl(): Promise<void> {
  if (!navigator.clipboard?.readText) return
  let raw: string
  try {
    raw = await navigator.clipboard.readText()
  } catch {
    // Clipboard permission denied (Safari prompts on first read; if user
    // declines, fail silent — the manual paste form still works).
    return
  }
  if (!raw) return
  // Accept either bare URL or "GLANCE:<url>" / "glance:<url>" prefix.
  const stripped = raw.replace(/^glance:\s*/i, '').trim()
  if (!looksLikeUrl(stripped)) return
  if (stripped === lastOfferedClipboardUrl) return // already prompted
  lastOfferedClipboardUrl = stripped
  // Use a custom non-blocking banner instead of confirm() so the user
  // can keep using the page if they don't want to add right now.
  showClipboardBanner(stripped)
}

function showClipboardBanner(url: string): void {
  // Remove any prior banner.
  document.getElementById('clipboard-banner')?.remove()
  const banner = document.createElement('div')
  banner.id = 'clipboard-banner'
  banner.style.cssText =
    'position: sticky; top: 0; padding: .75rem 1rem; background: #fef991; color: #232323; border-bottom: 1px solid #e5e08a; display: flex; align-items: center; gap: .75rem; font-size: .9em; z-index: 10;'
  const truncated = url.length > 60 ? `${url.slice(0, 60)}…` : url
  banner.innerHTML = `
    <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
      <strong>URL on clipboard:</strong> ${escapeHtml(truncated)}
    </span>
    <button id="clipboard-banner-add" style="padding: .35rem .7rem; cursor: pointer; border: 1px solid #232323; background: #232323; color: #fff;">Save to inbox</button>
    <button id="clipboard-banner-dismiss" style="padding: .35rem .7rem; cursor: pointer; border: 1px solid #999; background: transparent; color: #232323;">Dismiss</button>
  `
  document.body.prepend(banner)
  document.getElementById('clipboard-banner-add')!.addEventListener('click', async () => {
    const item = await addInboxItem(url)
    inboxStatus.style.color = '#2a2'
    inboxStatus.textContent = `Saved: ${item.title.slice(0, 60)}`
    banner.remove()
  })
  document.getElementById('clipboard-banner-dismiss')!.addEventListener('click', () => {
    banner.remove()
  })
}

window.addEventListener('focus', () => {
  // Best-effort. Clipboard read can require user gesture on first call;
  // we still try because once the user has clicked anywhere on the page
  // it usually works.
  void checkClipboardForSavedUrl()
})
// Also try once on first interaction — gives Safari its required user
// gesture and surfaces any clipboard URL the moment the user touches the
// page.
document.addEventListener(
  'click',
  () => {
    void checkClipboardForSavedUrl()
  },
  { once: true },
)

jinaKeyClear.addEventListener('click', async () => {
  jinaKeyInput.value = ''
  await setJinaApiKey(null)
  setJinaApiKeyCache(null)
  jinaKeyStatus.style.color = '#7b7b7b'
  jinaKeyStatus.textContent = 'Cleared. Back to free tier.'
  window.setTimeout(() => { jinaKeyStatus.textContent = '' }, 3000)
})

pasteBtn.addEventListener('click', async () => {
  inboxStatus.style.color = '#7b7b7b'
  inboxStatus.textContent = 'Reading clipboard…'
  try {
    const text = await navigator.clipboard.readText()
    if (!text) {
      inboxStatus.style.color = '#c00'
      inboxStatus.textContent = 'Clipboard is empty.'
      return
    }
    if (!looksLikeUrl(text.trim())) {
      inboxStatus.style.color = '#c00'
      inboxStatus.textContent = `Clipboard isn't a URL (${text.slice(0, 40)}…).`
      return
    }
    inboxUrlInput.value = text.trim()
    inboxStatus.style.color = '#2a2'
    inboxStatus.textContent = 'Pasted — review and tap "Save to inbox".'
  } catch (err) {
    inboxStatus.style.color = '#c00'
    inboxStatus.textContent = `Clipboard access denied: ${err instanceof Error ? err.message : String(err)}`
  }
})

// --- glasses-side rendering helpers ---

let even: EvenRuntime | null = null

function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

// Sliding-window list rendering. Returns the slice of items the cursor
// should be visible within, so we always show context above + below.
function windowForCursor(total: number, cursor: number, size: number): { start: number; end: number } {
  if (total <= size) return { start: 0, end: total }
  const half = Math.floor(size / 2)
  let start = Math.max(0, cursor - half)
  let end = start + size
  if (end > total) {
    end = total
    start = total - size
  }
  return { start, end }
}

function renderSourcesView(): string {
  if (state.sources.length === 0) {
    return [
      'GLANCE — no sources',
      '',
      'Add sources from the phone app:',
      'open Glance in the Even Hub',
      'companion before putting on',
      'the glasses.',
    ].join('\n')
  }
  const lines: string[] = [`GLANCE  v${__APP_VERSION__}`]
  const { start, end } = windowForCursor(state.sources.length, sourceCursor, VISIBLE_ROWS)
  for (let i = start; i < end; i += 1) {
    const s = state.sources[i]!
    const cursor = i === sourceCursor ? '> ' : '  '
    lines.push(`${cursor}${trunc(s.title, 26)}`)
  }
  // Position indicator if windowed.
  if (state.sources.length > VISIBLE_ROWS) {
    lines.push('')
    lines.push(`${sourceCursor + 1}/${state.sources.length} · [swipe] scroll`)
  } else {
    lines.push('')
    lines.push('[swipe] scroll · [tap] open')
  }
  return lines.join('\n')
}

function renderArticlesView(loading: boolean, error?: string): string {
  if (!currentSource) return 'No source selected.'
  const lines: string[] = [`${trunc(currentSource.title, 30).toUpperCase()}`]
  if (loading) {
    lines.push('')
    lines.push('Fetching articles…')
    return lines.join('\n')
  }
  if (error) {
    const friendly = friendlyError(error)
    lines.push('')
    lines.push(friendly)
    lines.push('')
    lines.push('[2x] back to sources')
    return lines.join('\n')
  }
  if (currentArticles.length === 0) {
    lines.push('')
    lines.push('No articles found.')
    lines.push('')
    lines.push('[2x] back to sources')
    return lines.join('\n')
  }
  const total = currentArticles.length
  const { start, end } = windowForCursor(total, articleCursor, VISIBLE_ROWS)
  for (let i = start; i < end; i += 1) {
    const a = currentArticles[i]!
    const cursor = i === articleCursor ? '> ' : '  '
    // Compact "✓" prefix for already-read articles. Helps the user skip
    // past finished items without re-tapping into them.
    const readMark = readUrls.has(a.url) ? '✓ ' : ''
    lines.push(`${cursor}${readMark}${trunc(a.title, 30)}`)
  }
  if (total > VISIBLE_ROWS) {
    lines.push('')
    lines.push(`${articleCursor + 1}/${total} · [swipe] · [tap] read`)
  } else {
    lines.push('')
    lines.push('[swipe] · [tap] read · [2x] back')
  }
  return lines.join('\n')
}

// Map raw network/extraction errors into user-friendly one-liners.
function friendlyError(raw: string): string {
  if (/451/.test(raw) || /SecurityCompromiseError/i.test(raw)) {
    return 'Rate-limited by Jina — try again in a few hours.'
  }
  if (/HTTP\s*4\d\d/i.test(raw)) {
    return 'Site refused the request. Try again or pick another source.'
  }
  if (/HTTP\s*5\d\d/i.test(raw) || /ESPN API HTTP/i.test(raw)) {
    return 'Source is having trouble. Try again later.'
  }
  if (/timed out|AbortError|aborted/i.test(raw)) {
    return 'Connection timed out. Network may be slow.'
  }
  if (/Failed to fetch|NetworkError|load failed/i.test(raw)) {
    return 'Network unreachable. Check Wi-Fi / Tailscale.'
  }
  return `Error: ${trunc(raw, 56)}`
}

function renderReaderView(loading: boolean, error?: string): string {
  if (!currentArticle) return 'No article selected.'
  if (loading) {
    return [trunc(currentArticle.title.toUpperCase(), 32), '', 'Fetching article…'].join('\n')
  }
  if (error) {
    return [
      trunc(currentArticle.title.toUpperCase(), 32),
      '',
      `Error: ${trunc(error, 60)}`,
      '',
      '[2x] back to articles',
    ].join('\n')
  }
  if (currentPages.length === 0) {
    return [
      trunc(currentArticle.title.toUpperCase(), 32),
      '',
      'Article body empty.',
      '',
      '[2x] back to articles',
    ].join('\n')
  }
  const total = currentPages.length
  const i = Math.max(0, Math.min(currentPageIndex, total - 1))
  const page = currentPages[i] ?? ''
  const lines: string[] = [
    `${trunc(currentArticle.title.toUpperCase(), 32)}`,
    `Page ${i + 1}/${total}`,
    '',
    page,
  ]
  if (total > 1) {
    lines.push('')
    lines.push('[swipe] flip · [2x] back')
  }
  return lines.join('\n')
}

async function paint(loading = false, error?: string): Promise<void> {
  if (!even) return
  let text: string
  if (view === 'sources') text = renderSourcesView()
  else if (view === 'articles') text = renderArticlesView(loading, error)
  else text = renderReaderView(loading, error)
  // Structured console signal for the regression-test harness. Lets the
  // simulator-automation script verify state transitions deterministically
  // without doing OCR on screenshots.
  const tag = loading ? `${view}:loading` : error ? `${view}:error` : view
  const detail =
    view === 'sources'
      ? `cursor=${sourceCursor}/${state.sources.length}`
      : view === 'articles'
        ? `cursor=${articleCursor}/${currentArticles.length} src=${currentSource?.id ?? '?'}`
        : `page=${currentPageIndex + 1}/${currentPages.length}`
  // eslint-disable-next-line no-console
  console.log(`[glance:state] ${tag} ${detail}`)
  await even.render(text)
}

// --- navigation ---

async function openSource(source: Source): Promise<void> {
  currentSource = source
  view = 'articles'
  currentArticles = []
  articleCursor = 0
  await paint(true)

  // Inbox is always re-read from storage (cheap) so newly-added articles
  // appear immediately. Other sources hit a 5-minute in-memory cache.
  if (source.adapter !== 'inbox') {
    const cached = articleListCache.get(source.id)
    if (cached && Date.now() - cached.fetchedAt < ARTICLE_LIST_TTL_MS) {
      currentArticles = cached.articles
      await paint()
      return
    }
  }
  try {
    const adapter = getAdapter(source)
    const articles = await adapter.fetchHomepage(source)
    if (source.adapter !== 'inbox') {
      articleListCache.set(source.id, {
        articles,
        fetchedAt: Date.now(),
        sourceUrl: source.url,
      })
    }
    source.lastFetchedAt = Date.now()
    await saveState(state)
    currentArticles = articles
    await paint()
  } catch (err) {
    const message = err instanceof JinaError ? err.message : err instanceof Error ? err.message : String(err)
    await paint(false, message)
  }
}

// Phone-side "Save & open now" sets KEY_PENDING_OPEN to a URL the user
// just saved. On bootstrap and on each foreground, we check + clear that
// key and navigate straight to the article view. Returns true when it
// consumed something so the caller can skip its own default render.
async function tryConsumePendingOpen(): Promise<boolean> {
  const url = await getPendingOpen()
  if (!url) return false
  await clearPendingOpen()
  // Navigate from the inbox source so "back" goes to the inbox list.
  const inboxSrc = state.sources.find(s => s.adapter === 'inbox') ?? null
  if (inboxSrc) currentSource = inboxSrc
  view = 'reader'
  await openArticle({ url, title: '' })
  return true
}

// v0.5.6: generation counter for openArticle. A slow fetch from article
// A must NOT apply its body to currentArticle if the user has navigated
// elsewhere (back to articles list, or to a different article B). Each
// openArticle invocation captures a generation; the resolver checks it
// before mutating shared state.
const articleGen = makeGenerationCounter()

async function openArticle(article: Article): Promise<void> {
  const myGen = articleGen.next()
  currentArticle = article
  currentPages = []
  currentPageIndex = 0
  view = 'reader'
  await paint(true)

  // Persist resume position.
  if (currentSource) {
    state.resume = { sourceId: currentSource.id, articleUrl: article.url, page: 0 }
    await saveState(state)
  }

  try {
    const cached = await getCachedBody(article.url)
    let body: string
    let title: string = article.title
    if (cached) {
      body = cached.body
      title = cached.title || article.title
    } else {
      const adapter = currentSource ? getAdapter(currentSource) : getAdapter({
        id: '__synthetic',
        url: article.url,
        title: article.title,
      } as Source)
      const result = await adapter.fetchArticleBody(currentSource!, article)
      body = result.body
      title = result.title || article.title
      // Only cache real bodies — adapter-generated placeholder messages
      // (paywall/bot-wall warnings) shouldn't poison the cache, the user
      // might re-try later when the site cooperates.
      if (!result.classification) {
        await putCachedBody({
          url: article.url,
          title,
          body,
          fetchedAt: Date.now(),
        })
      }
    }
    // v0.5.6: stale-resolution check. If the user navigated away (and
    // articleGen advanced past myGen), the in-flight fetch we just
    // resolved is for an article that's no longer on screen. Drop the
    // result silently — the cache write above already happened (good,
    // future taps benefit), but don't mutate UI state.
    if (myGen !== articleGen.current()) return
    currentArticle = { url: article.url, title }
    currentPages = paginateForMode(body)
    currentPageIndex = 0
    await paint()
  } catch (err) {
    if (myGen !== articleGen.current()) return
    const message = err instanceof JinaError ? err.message : err instanceof Error ? err.message : String(err)
    await paint(false, message)
  }
}

async function goBack(): Promise<void> {
  if (view === 'reader') {
    view = 'articles'
    currentArticle = null
    currentPages = []
    currentPageIndex = 0
    if (currentSource) {
      state.resume = { sourceId: currentSource.id }
      await saveState(state)
    }
    await paint()
    return
  }
  if (view === 'articles') {
    view = 'sources'
    currentSource = null
    currentArticles = []
    articleCursor = 0
    state.resume = undefined
    await saveState(state)
    await paint()
  }
}

async function flipPage(delta: number): Promise<void> {
  if (view !== 'reader') return
  if (currentPages.length === 0) return
  const next = currentPageIndex + delta
  if (next < 0 || next >= currentPages.length) return
  currentPageIndex = next
  if (currentSource && currentArticle) {
    state.resume = {
      sourceId: currentSource.id,
      articleUrl: currentArticle.url,
      page: currentPageIndex,
    }
    await saveState(state)
  }
  // Mark as read when the user reaches the LAST page — proxy for "they
  // finished reading it." Multi-page articles only; single-page reads
  // are too easy to land on accidentally.
  if (
    currentArticle &&
    currentPages.length > 1 &&
    currentPageIndex === currentPages.length - 1 &&
    !readUrls.has(currentArticle.url)
  ) {
    readUrls.add(currentArticle.url)
    void markRead(currentArticle.url)
  }
  await paint()
}

// --- input wiring ---

function onTap(_source: InputSource): void {
  if (view === 'sources') {
    if (state.sources.length === 0) return
    const source = state.sources[sourceCursor]
    if (source) void openSource(source)
    return
  }
  if (view === 'articles') {
    if (currentArticles.length === 0) return
    const article = currentArticles[articleCursor]
    if (article) void openArticle(article)
    return
  }
  // Reader: tap acts as "next page" — same as swipe down.
  void flipPage(+1)
}

function onSwipe(dir: 'up' | 'down'): void {
  if (view === 'reader') {
    void flipPage(dir === 'down' ? +1 : -1)
    return
  }
  // Swipe-down moves the cursor forward (down the list); swipe-up moves
  // it backward. Wraps around at the ends because lists can be long.
  const delta = dir === 'down' ? +1 : -1
  if (view === 'sources') {
    const total = state.sources.length
    if (total === 0) return
    sourceCursor = (sourceCursor + delta + total) % total
    void paint()
    return
  }
  if (view === 'articles') {
    const total = currentArticles.length
    if (total === 0) return
    articleCursor = (articleCursor + delta + total) % total
    void paint()
    return
  }
}

function onDoubleTap(_source: InputSource): void {
  // Double-tap = back, regardless of source. Glasses convention is exit
  // on glasses-2-tap, but Glance follows the same user preference as
  // Pulse (back-then-exit, see CLAUDE.md note in Pulse).
  if (view === 'reader' || view === 'articles') {
    void goBack()
    return
  }
  // Sources view: glasses-2-tap exits app.
  if (even) void even.exitApp()
}

// --- bootstrap ---

async function bootstrap(): Promise<void> {
  status.textContent = 'Connecting to glasses…'
  const initial = `GLANCE v${__APP_VERSION__}\n\nLoading sources…`
  even = await connectEvenRuntime(initial)

  if (even) {
    const bridge = {
      getStorage: even.getStorage,
      setStorage: even.setStorage,
    }
    setStorageBridge(bridge)
    setInboxBridge(bridge)
  }

  // Wire the jina fetch logger so the phone-side debug panel sees every
  // r.jina.ai call (success + failure). Independent of bridge — works in
  // browser preview too.
  setJinaLogger(pushFetchLog)
  renderFetchLog()

  // Hydrate Jina API key (if previously set) into the runtime cache so
  // fetchViaJina sees it on first call. Also seed the settings input.
  const savedJinaKey = await getJinaApiKey()
  if (savedJinaKey) {
    setJinaApiKeyCache(savedJinaKey)
    jinaKeyInput.value = savedJinaKey
  }

  // Hydrate default Worker config (when set, all article-body fetches try
  // it before falling back to r.jina.ai — see adapters/jina.ts). Also
  // seed the settings inputs.
  const savedWorker = await getDefaultWorker()
  if (savedWorker) {
    setDefaultWorkerCache(savedWorker)
    defaultWorkerUrlInput.value = savedWorker.workerUrl
    defaultWorkerTokenInput.value = savedWorker.bearerToken
  } else {
    setDefaultWorkerCache(null)
  }

  // Hydrate scroll mode for paginate cap.
  scrollMode = await getScrollMode()
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="scroll-mode"]')) {
    radio.checked = radio.value === scrollMode
  }

  // Hydrate the read-state set so the article list shows ✓ markers.
  readUrls = await loadReadUrls()

  // Load persisted state, seed defaults on first launch.
  state = await loadState()
  if (state.sources.length === 0) {
    state.sources = [...DEFAULT_SOURCES]
    await saveState(state)
  } else {
    // Migration for installs that predate adapter sources (v0.1.0 → v0.2.0+).
    // - Always ensure exactly one inbox source exists at position 0
    // - If a generic ESPN source exists (jina adapter, espn.com URL), upgrade it
    //   in-place to the espn-news adapter so it actually fetches articles
    let dirty = false
    const hasInbox = state.sources.some(s => s.adapter === 'inbox')
    if (!hasInbox) {
      const inbox = DEFAULT_SOURCES.find(s => s.adapter === 'inbox')
      if (inbox) {
        state.sources.unshift({ ...inbox, id: `${inbox.id}_migrated` })
        dirty = true
      }
    }
    for (const s of state.sources) {
      const hostMatch = /^https?:\/\/(www\.)?espn\.com/.test(s.url) && !s.adapter
      if (hostMatch) {
        s.adapter = 'espn-news'
        s.adapterConfig = { league: 'football/nfl' }
        s.url = 'espn-news://football/nfl'
        s.title = s.title.toLowerCase().includes('espn') ? s.title : `${s.title} (NFL)`
        dirty = true
      }
    }
    if (dirty) await saveState(state)
  }
  renderSourcesList()

  if (!even) {
    status.textContent = 'Running outside the Even runtime — browser preview only.'
    return
  }

  status.textContent = 'Glasses connected. Use them to navigate.'

  even.onTap(onTap)
  even.onSwipe(onSwipe)
  even.onDoubleTap(onDoubleTap)
  even.onForeground(() => {
    void (async () => {
      // Phone-side "Save & open now" sets a one-shot pendingOpen pointer.
      // On every foreground, check + consume it before paint so the user
      // sees the article immediately on putting glasses back on.
      const consumed = await tryConsumePendingOpen()
      if (!consumed) await paint()
    })()
  })

  // Phone-side "Save & open now" button might have fired before the
  // glasses connected — check on bootstrap too. Takes precedence over
  // resume restore.
  if (await tryConsumePendingOpen()) return

  // Resume to last article + page if persisted.
  if (state.resume?.sourceId) {
    const src = state.sources.find(s => s.id === state.resume!.sourceId)
    if (src) {
      currentSource = src
      if (state.resume.articleUrl) {
        view = 'reader'
        currentArticle = { url: state.resume.articleUrl, title: '' }
        currentPageIndex = state.resume.page ?? 0
        await paint(true)
        try {
          const cached = await getCachedBody(state.resume.articleUrl)
          if (cached) {
            currentArticle = { url: cached.url, title: cached.title }
            currentPages = paginateForMode(cached.body)
            await paint()
            return
          }
        } catch {
          // fall through
        }
        // Cache miss → re-fetch.
        await openArticle({ url: state.resume.articleUrl, title: '' })
        return
      }
      view = 'articles'
      await openSource(src)
      return
    }
  }

  await paint()
}

void bootstrap()
