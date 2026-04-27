// Glance storage layer. Wraps the SDK's native bridge.setLocalStorage /
// getLocalStorage with typed accessors and a browser-localStorage fallback
// for the dev-server preview where there's no Even bridge.
//
// The bridge handle is supplied at runtime — main.ts calls setStorageBridge
// once after connecting. Until then, all calls fall back to browser storage
// so module-load-time imports don't crash.

import { makeWriteSerializer } from './inflight'
import type { ArticleBody, ReaderState, Source } from './types'

// v0.5.6: cache writes go through a single chain so concurrent
// putCachedBody calls can't race on the body-index read-modify-write
// cycle. Without this, two simultaneous puts could each read the
// 99-entry index, both push, both write back the 100-entry version,
// and lose one entry's eviction work. The serializer makes B wait
// for A to finish its full read-modify-write before starting.
const serializeCacheWrite = makeWriteSerializer()

interface BridgeStorageLike {
  getStorage: (key: string) => Promise<string>
  setStorage: (key: string, value: string) => Promise<boolean>
}

let bridge: BridgeStorageLike | null = null

export function setStorageBridge(b: BridgeStorageLike | null): void {
  bridge = b
}

async function readRaw(key: string): Promise<string | null> {
  try {
    if (bridge) {
      const v = await bridge.getStorage(key)
      return v || null
    }
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

async function writeRaw(key: string, value: string): Promise<void> {
  try {
    if (bridge) {
      await bridge.setStorage(key, value)
      return
    }
    window.localStorage.setItem(key, value)
  } catch {
    // Quota / disabled storage — silent. Glance degrades gracefully:
    // re-fetches from r.jina.ai on next view, just slower.
  }
}

const KEY_STATE = 'reader:state:v1'
const KEY_BODY_PREFIX = 'reader:body:'
// Index of cached article URLs, newest-first. Trimmed to BODY_CACHE_CAP on
// every write so we don't grow unbounded.
const KEY_BODY_INDEX = 'reader:bodyIndex:v1'
// Optional Jina API key — when set, sent as Authorization: Bearer header
// to bump rate limits past the free 200/day per IP per domain.
const KEY_JINA_API_KEY = 'reader:jinaApiKey:v1'
// Optional default Worker — when set, ALL article-body fetches try this
// Worker before falling back to r.jina.ai. Different from per-source
// paywall workers (those bind to one specific site URL); this one is
// the universal extractor. Reduces dependency on r.jina.ai for cold
// starts + rate limits.
const KEY_DEFAULT_WORKER_URL = 'reader:defaultWorkerUrl:v1'
const KEY_DEFAULT_WORKER_TOKEN = 'reader:defaultWorkerToken:v1'
// One-shot pointer set by the phone-side "Browse now" button. Glasses
// consumes it on next foreground/render and auto-navigates to the
// pointed-at article. Closes the gap with ER Browser's one-step
// "type URL → read" flow.
const KEY_PENDING_OPEN = 'reader:pendingOpen:v1'
// User-toggled scroll mode. 'page' = ~400-char paginate (default).
// 'line' = ~80-char paginate so each swipe advances less text. Matches
// ER Browser's line-by-line option.
const KEY_SCROLL_MODE = 'reader:scrollMode:v1'
// Set of article URLs the user has finished reading. Trimmed to a hard
// cap (most-recent-N) so it doesn't grow unbounded.
const KEY_READ_URLS = 'reader:readUrls:v1'
const READ_URL_CAP = 500

const BODY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const BODY_CACHE_CAP = 100

export async function loadState(): Promise<ReaderState> {
  const raw = await readRaw(KEY_STATE)
  if (!raw) return { sources: [] }
  try {
    return JSON.parse(raw) as ReaderState
  } catch {
    return { sources: [] }
  }
}

export async function saveState(state: ReaderState): Promise<void> {
  await writeRaw(KEY_STATE, JSON.stringify(state))
}

export async function setSources(sources: Source[]): Promise<void> {
  const state = await loadState()
  state.sources = sources
  await saveState(state)
}

export async function setResume(resume: ReaderState['resume']): Promise<void> {
  const state = await loadState()
  state.resume = resume
  await saveState(state)
}

// --- Jina API key (optional) ---

export async function getJinaApiKey(): Promise<string | null> {
  const raw = await readRaw(KEY_JINA_API_KEY)
  const trimmed = (raw ?? '').trim()
  return trimmed ? trimmed : null
}

export async function setJinaApiKey(key: string | null): Promise<void> {
  await writeRaw(KEY_JINA_API_KEY, (key ?? '').trim())
}

// --- Default Worker (universal extractor — bypasses r.jina.ai) ---

export interface DefaultWorker {
  workerUrl: string
  bearerToken: string
}

export async function getDefaultWorker(): Promise<DefaultWorker | null> {
  const url = (await readRaw(KEY_DEFAULT_WORKER_URL))?.trim()
  const token = (await readRaw(KEY_DEFAULT_WORKER_TOKEN))?.trim()
  if (!url || !token) return null
  return { workerUrl: url, bearerToken: token }
}

export async function setDefaultWorker(workerUrl: string, bearerToken: string): Promise<void> {
  await writeRaw(KEY_DEFAULT_WORKER_URL, workerUrl.trim())
  await writeRaw(KEY_DEFAULT_WORKER_TOKEN, bearerToken.trim())
}

export async function clearDefaultWorker(): Promise<void> {
  await writeRaw(KEY_DEFAULT_WORKER_URL, '')
  await writeRaw(KEY_DEFAULT_WORKER_TOKEN, '')
}

// --- Pending open (one-shot from phone-side "Browse now") ---

export async function getPendingOpen(): Promise<string | null> {
  const raw = (await readRaw(KEY_PENDING_OPEN))?.trim()
  return raw ? raw : null
}

export async function setPendingOpen(url: string): Promise<void> {
  await writeRaw(KEY_PENDING_OPEN, url.trim())
}

export async function clearPendingOpen(): Promise<void> {
  await writeRaw(KEY_PENDING_OPEN, '')
}

// --- Scroll mode ---

export type ScrollMode = 'page' | 'line'

export async function getScrollMode(): Promise<ScrollMode> {
  const raw = (await readRaw(KEY_SCROLL_MODE))?.trim()
  return raw === 'line' ? 'line' : 'page'
}

export async function setScrollMode(mode: ScrollMode): Promise<void> {
  await writeRaw(KEY_SCROLL_MODE, mode)
}

// --- Read-state ---
//
// Stored as a compact array of URLs (most-recent first) rather than a Set
// so JSON serialization is straightforward and we can LRU-evict cleanly.

export async function loadReadUrls(): Promise<Set<string>> {
  const raw = await readRaw(KEY_READ_URLS)
  if (!raw) return new Set()
  try {
    const arr = JSON.parse(raw) as string[]
    return Array.isArray(arr) ? new Set(arr) : new Set()
  } catch {
    return new Set()
  }
}

export async function markRead(url: string): Promise<void> {
  if (!url) return
  const raw = await readRaw(KEY_READ_URLS)
  let arr: string[] = []
  try {
    arr = raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    arr = []
  }
  // Move-to-front semantics so the most-recently-read survives eviction.
  arr = [url, ...arr.filter(u => u !== url)]
  if (arr.length > READ_URL_CAP) arr.length = READ_URL_CAP
  await writeRaw(KEY_READ_URLS, JSON.stringify(arr))
}

export async function unmarkRead(url: string): Promise<void> {
  if (!url) return
  const raw = await readRaw(KEY_READ_URLS)
  if (!raw) return
  try {
    const arr = JSON.parse(raw) as string[]
    if (!Array.isArray(arr)) return
    const filtered = arr.filter(u => u !== url)
    if (filtered.length === arr.length) return
    await writeRaw(KEY_READ_URLS, JSON.stringify(filtered))
  } catch {
    /* swallow */
  }
}

// --- article body cache ---

interface BodyIndexEntry {
  url: string
  fetchedAt: number
}

async function readBodyIndex(): Promise<BodyIndexEntry[]> {
  const raw = await readRaw(KEY_BODY_INDEX)
  if (!raw) return []
  try {
    return JSON.parse(raw) as BodyIndexEntry[]
  } catch {
    return []
  }
}

async function writeBodyIndex(index: BodyIndexEntry[]): Promise<void> {
  await writeRaw(KEY_BODY_INDEX, JSON.stringify(index))
}

function bodyKey(url: string): string {
  // Hash by URL — collisions are fine, we'd just re-fetch. Use the URL
  // directly as part of the key (encoded) to keep it simple + debuggable.
  return KEY_BODY_PREFIX + encodeURIComponent(url)
}

export async function getCachedBody(url: string): Promise<ArticleBody | null> {
  const raw = await readRaw(bodyKey(url))
  if (!raw) return null
  try {
    const body = JSON.parse(raw) as ArticleBody
    // TTL check — re-fetch on stale.
    if (Date.now() - body.fetchedAt > BODY_CACHE_TTL_MS) return null
    return body
  } catch {
    return null
  }
}

export async function putCachedBody(body: ArticleBody): Promise<void> {
  // v0.5.6: serialize the entire body+index update so concurrent puts
  // can't race on the read-modify-write of the body index. Body itself
  // is keyed by URL (no race), but the index needs atomic R-M-W.
  return serializeCacheWrite(async () => {
    await writeRaw(bodyKey(body.url), JSON.stringify(body))
    // Update index, dedupe, evict oldest beyond cap.
    const index = await readBodyIndex()
    const filtered = index.filter(e => e.url !== body.url)
    filtered.unshift({ url: body.url, fetchedAt: body.fetchedAt })
    while (filtered.length > BODY_CACHE_CAP) {
      const oldest = filtered.pop()
      if (oldest) await writeRaw(bodyKey(oldest.url), '')
    }
    await writeBodyIndex(filtered)
  })
}
