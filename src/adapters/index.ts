// Adapter registry. Each Source picks one of these via its `adapter`
// field; the default is 'jina'. Adding a new adapter means writing a
// module that exports an Adapter and registering it here.

import type { AdapterKind, Article, Source } from '../types'
import { jinaAdapter } from './jina'
import { espnAdapter } from './espn'
import { inboxAdapter } from './inbox'
import { workerAdapter } from './worker'

export interface ArticleBody {
  title: string
  body: string
  // Optional reason if the body is a placeholder (paywall, bot-wall,
  // empty extraction). Used by the reader view to display a meaningful
  // status instead of pretending it's the real article.
  classification?: 'too-short' | 'paywall' | 'bot-wall'
}

export interface Adapter {
  fetchHomepage: (source: Source) => Promise<Article[]>
  fetchArticleBody: (source: Source, article: Article) => Promise<ArticleBody>
  homepageUrlForDisplay: (source: Source) => string
}

const REGISTRY: Record<AdapterKind, Adapter> = {
  jina: jinaAdapter,
  'espn-news': espnAdapter,
  inbox: inboxAdapter,
  worker: workerAdapter,
}

export function getAdapter(source: Source): Adapter {
  return REGISTRY[source.adapter ?? 'jina']
}
