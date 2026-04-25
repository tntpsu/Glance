// Glance entry point. Three-layer navigation (sources → article list →
// reader) wired through the openPicker modal for selection at each layer.
//
// Phone-side settings UI is rendered into #app — visible when the user
// opens the plugin in the Even Hub companion app on the phone (before
// putting glasses on). The glasses-side display is driven via the
// EvenRuntime returned from connectEvenRuntime.

import { connectEvenRuntime, type EvenRuntime, type InputSource } from './even'
import { extractArticles } from './extract'
import { classifyBody, fetchViaJina, JinaError } from './jina'
import { paginate } from './paginate'
import { DEFAULT_SOURCES, looksLikeUrl, makeSource } from './sources'
import {
  getCachedBody,
  loadState,
  putCachedBody,
  saveState,
  setStorageBridge,
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

let pickerOpen = false

// --- DOM scaffold (phone-side settings UI) ---

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('App root missing')

root.innerHTML = `
  <main style="font-family: system-ui; padding: 1rem; max-width: 720px; margin: 0 auto; color: #232323;">
    <h1 style="margin: 0 0 .25rem 0;">Glance <span style="font-size: .55em; color: #7b7b7b; font-weight: 400;">v${__APP_VERSION__}</span></h1>
    <p style="color: #7b7b7b; margin: 0 0 1.5rem 0;">Read articles from your saved sites on Even G2 glasses.</p>

    <p id="status" style="margin: 0 0 1rem 0;">Connecting…</p>

    <section>
      <h2 style="font-size: 1.1em; margin: 0 0 .5rem 0;">Sources</h2>
      <ul id="sources-list" style="list-style: none; padding: 0; margin: 0 0 1rem 0;"></ul>

      <details style="margin-bottom: 1rem;">
        <summary style="cursor: pointer; color: #232323;">Add a source</summary>
        <form id="add-source-form" style="margin-top: .5rem; display: grid; gap: .25rem; max-width: 480px;">
          <label>Title <input id="src-title" type="text" required style="padding: .35rem; width: 100%; box-sizing: border-box;" /></label>
          <label>URL <input id="src-url" type="url" required placeholder="https://example.com" style="padding: .35rem; width: 100%; box-sizing: border-box;" /></label>
          <button type="submit" style="margin-top: .25rem; padding: .4rem .8rem; cursor: pointer; max-width: 120px;">Add</button>
          <p id="add-error" style="color: #c00; margin: .25rem 0 0 0; font-size: .85em;"></p>
        </form>
      </details>

      <button id="reset-defaults" style="padding: .35rem .7rem; cursor: pointer; font-size: .85em; color: #7b7b7b;">Reset to default sources</button>
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

// --- glasses-side rendering helpers ---

let even: EvenRuntime | null = null

function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
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
  const lines: string[] = [`GLANCE  v${__APP_VERSION__}`, '']
  state.sources.forEach((s, i) => {
    const cursor = i === currentSourceIndex() ? '> ' : '  '
    lines.push(`${cursor}${trunc(s.title, 26)}`)
  })
  lines.push('')
  lines.push('[tap] open · [2x] exit')
  return lines.join('\n')
}

function currentSourceIndex(): number {
  if (!currentSource) return 0
  const idx = state.sources.findIndex(s => s.id === currentSource!.id)
  return idx >= 0 ? idx : 0
}

function renderArticlesView(loading: boolean, error?: string): string {
  if (!currentSource) return 'No source selected.'
  const lines: string[] = [`${currentSource.title.toUpperCase()}`, '']
  if (loading) {
    lines.push('Fetching articles…')
    return lines.join('\n')
  }
  if (error) {
    lines.push(`Error: ${trunc(error, 60)}`)
    lines.push('')
    lines.push('[2x] back to sources')
    return lines.join('\n')
  }
  if (currentArticles.length === 0) {
    lines.push('No articles found.')
    lines.push('')
    lines.push('[2x] back to sources')
    return lines.join('\n')
  }
  const max = Math.min(currentArticles.length, 6)
  for (let i = 0; i < max; i += 1) {
    const a = currentArticles[i]!
    const idx = i + 1
    lines.push(`${idx}. ${trunc(a.title, 36)}`)
  }
  if (currentArticles.length > max) {
    lines.push('')
    lines.push(`+${currentArticles.length - max} more — [tap] picker`)
  } else {
    lines.push('')
    lines.push('[tap] open article')
  }
  return lines.join('\n')
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
  await even.render(text)
}

// --- navigation ---

async function openSourcePicker(): Promise<void> {
  if (!even || pickerOpen) return
  if (state.sources.length === 0) return
  pickerOpen = true
  try {
    const labels = state.sources.map(s => trunc(s.title, 28))
    const picked = await even.openPicker('Sources', labels)
    if (picked === null) return
    const source = state.sources[picked]
    if (!source) return
    await openSource(source)
  } finally {
    pickerOpen = false
  }
}

async function openSource(source: Source): Promise<void> {
  currentSource = source
  view = 'articles'
  currentArticles = []
  await paint(true)

  const cached = articleListCache.get(source.id)
  if (cached && Date.now() - cached.fetchedAt < ARTICLE_LIST_TTL_MS) {
    currentArticles = cached.articles
    await paint()
    return
  }
  try {
    const result = await fetchViaJina(source.url)
    const articles = extractArticles(result.markdown, source.url)
    articleListCache.set(source.id, {
      articles,
      fetchedAt: Date.now(),
      sourceUrl: source.url,
    })
    source.lastFetchedAt = Date.now()
    await saveState(state)
    currentArticles = articles
    await paint()
  } catch (err) {
    const message = err instanceof JinaError ? err.message : err instanceof Error ? err.message : String(err)
    await paint(false, message)
  }
}

async function openArticlePicker(): Promise<void> {
  if (!even || pickerOpen) return
  if (currentArticles.length === 0) return
  pickerOpen = true
  try {
    const labels = currentArticles.slice(0, 30).map((a, i) => `${i + 1}. ${trunc(a.title, 38)}`)
    const picked = await even.openPicker(currentSource?.title ?? 'Articles', labels)
    if (picked === null) return
    const article = currentArticles[picked]
    if (!article) return
    await openArticle(article)
  } finally {
    pickerOpen = false
  }
}

async function openArticle(article: Article): Promise<void> {
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
      const result = await fetchViaJina(article.url)
      body = result.markdown
      title = result.title || article.title
      await putCachedBody({
        url: article.url,
        title,
        body,
        fetchedAt: Date.now(),
      })
    }
    currentArticle = { url: article.url, title }
    // Classify before pagination so we can show a meaningful error
    // instead of a single empty page.
    const classification = classifyBody(body)
    if (!classification.ok) {
      const reasonText =
        classification.reason === 'paywall'
          ? 'This article appears to be behind a paywall. Open it in your browser to read the full text.'
          : classification.reason === 'bot-wall'
            ? 'This site blocks automated access. Try a different source.'
            : 'Article body looks empty — extraction may have failed.'
      currentPages = paginate(reasonText)
      currentPageIndex = 0
      await paint()
      return
    }
    currentPages = paginate(body)
    currentPageIndex = 0
    await paint()
  } catch (err) {
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
  await paint()
}

// --- input wiring ---

function onTap(_source: InputSource): void {
  if (view === 'sources') {
    void openSourcePicker()
    return
  }
  if (view === 'articles') {
    void openArticlePicker()
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
  if (view === 'articles' && currentArticles.length > 6) {
    // No paging in the static dashboard view, but tapping the picker
    // gives full access. Treat swipe as picker-shortcut.
    void openArticlePicker()
    return
  }
  // Sources view: nothing to scroll yet (everything fits).
}

function onDoubleTap(_source: InputSource): void {
  // Double-tap = back, regardless of source. Glasses convention is exit
  // on glasses-2-tap, but Glance follows the same user preference as
  // Phils Home (back-then-exit, see CLAUDE.md note in PhilsHome).
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
    setStorageBridge({
      getStorage: even.getStorage,
      setStorage: even.setStorage,
    })
  }

  // Load persisted state, seed defaults on first launch.
  state = await loadState()
  if (state.sources.length === 0) {
    state.sources = [...DEFAULT_SOURCES]
    await saveState(state)
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
    void paint()
  })

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
            currentPages = paginate(cached.body)
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
