// Core types for Glance. Persisted shapes use camelCase JSON. Storage keys
// are namespaced "reader:" so a future plugin in the same Even Hub install
// can't accidentally collide.

export interface Source {
  id: string // UUID
  url: string // homepage or section URL — e.g. "https://espn.com"
  title: string // user-supplied display name — e.g. "ESPN"
  lastFetchedAt?: number
}

export interface Article {
  url: string // absolute URL of the article
  title: string // headline
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
