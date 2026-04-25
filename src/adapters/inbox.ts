// Inbox adapter — a special "source" that holds individual article URLs
// saved by the user (paste from clipboard, or via an iOS Shortcut writing
// to the same storage key). Article-body fetch delegates to jinaAdapter
// since saved URLs are arbitrary external articles.
//
// Storage: { url, title, addedAt }[] under a dedicated key, separate
// from the main ReaderState so inbox manipulation can't accidentally
// clobber sources.

import type { Adapter, ArticleBody } from './index'
import type { Article, Source } from '../types'
import { jinaAdapter } from './jina'

const KEY_INBOX = 'reader:inbox:items:v1'

export interface InboxItem {
  url: string
  title: string // user-supplied OR derived from URL
  addedAt: number
}

interface BridgeStorageLike {
  getStorage: (key: string) => Promise<string>
  setStorage: (key: string, value: string) => Promise<boolean>
}

let bridge: BridgeStorageLike | null = null

export function setInboxBridge(b: BridgeStorageLike | null): void {
  bridge = b
}

async function readRaw(): Promise<string | null> {
  try {
    if (bridge) {
      const v = await bridge.getStorage(KEY_INBOX)
      return v || null
    }
    return window.localStorage.getItem(KEY_INBOX)
  } catch {
    return null
  }
}

async function writeRaw(value: string): Promise<void> {
  try {
    if (bridge) {
      await bridge.setStorage(KEY_INBOX, value)
      return
    }
    window.localStorage.setItem(KEY_INBOX, value)
  } catch {
    /* no-op */
  }
}

export async function loadInbox(): Promise<InboxItem[]> {
  const raw = await readRaw()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as InboxItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function saveInbox(items: InboxItem[]): Promise<void> {
  await writeRaw(JSON.stringify(items))
}

export async function addInboxItem(url: string, title?: string): Promise<InboxItem> {
  const items = await loadInbox()
  // Dedupe by URL — most-recent timestamp wins.
  const existing = items.findIndex(i => i.url === url)
  const now = Date.now()
  let derivedTitle: string
  if (title && title.trim()) {
    derivedTitle = title.trim()
  } else {
    try {
      const u = new URL(url)
      derivedTitle = `${u.hostname.replace(/^www\./, '')}${u.pathname.length > 1 ? u.pathname.slice(0, 40) : ''}`
    } catch {
      derivedTitle = url.slice(0, 60)
    }
  }
  const item: InboxItem = { url, title: derivedTitle, addedAt: now }
  if (existing >= 0) {
    items.splice(existing, 1)
  }
  items.unshift(item)
  // Cap at 100 to keep the picker manageable.
  if (items.length > 100) items.length = 100
  await saveInbox(items)
  return item
}

export async function removeInboxItem(url: string): Promise<void> {
  const items = await loadInbox()
  const filtered = items.filter(i => i.url !== url)
  await saveInbox(filtered)
}

export const inboxAdapter: Adapter = {
  async fetchHomepage(_source: Source): Promise<Article[]> {
    const items = await loadInbox()
    return items.map<Article>(i => ({
      url: i.url,
      title: i.title,
    }))
  },
  async fetchArticleBody(_source: Source, article: Article): Promise<ArticleBody> {
    return jinaAdapter.fetchArticleBody(_source, article)
  },
  homepageUrlForDisplay(_source: Source): string {
    return 'Saved articles (inbox)'
  },
}
