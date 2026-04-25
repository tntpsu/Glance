// Core types for Glance. Persisted shapes use camelCase JSON. Storage keys
// are namespaced "reader:" so a future plugin in the same Even Hub install
// can't accidentally collide.

export type AdapterKind = 'jina' | 'espn-news' | 'inbox' | 'worker'

export interface Source {
  id: string // UUID
  url: string // homepage URL for jina/worker; "espn-news://<league>"; "inbox://saved"
  title: string // user-supplied display name — e.g. "ESPN"
  adapter?: AdapterKind // defaults to 'jina' when absent
  // Per-adapter config grab-bag:
  // - espn-news: { league: 'football/nfl' }
  // - worker: { workerUrl: 'https://x.workers.dev', bearerToken: '...' }
  adapterConfig?: { league?: string; workerUrl?: string; bearerToken?: string }
  lastFetchedAt?: number
}

export interface Article {
  url: string // absolute URL of the article
  title: string // headline
  // Optional summary populated by the adapter at homepage-fetch time.
  // espn-news populates this from ESPN's API description so we can show
  // the article body without a second fetch (ESPN bot-walls r.jina.ai).
  summary?: string
  // Optional published timestamp (ISO8601) — populated by adapters that
  // surface it. Used for sort hints and display only.
  published?: string
}

export interface ArticleBody {
  url: string // cache key
  title: string
  body: string // clean markdown / plaintext
  fetchedAt: number
}

export type ViewMode = 'sources' | 'articles' | 'reader' | 'transient'

export interface ResumePoint {
  sourceId: string
  articleUrl?: string
  page?: number
}

export interface ReaderState {
  sources: Source[]
  resume?: ResumePoint
}

// Wrapped result from r.jina.ai — both the homepage and article endpoints
// return the same shape (Title / URL / Markdown Content blocks).
export interface JinaResult {
  title: string
  sourceUrl: string
  publishedTime?: string
  markdown: string
}
