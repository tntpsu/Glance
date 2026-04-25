// Default adapter: fetches a source's homepage via r.jina.ai, extracts
// article-shaped links from the returned markdown, and fetches article
// bodies on-demand via the same service.

import { extractArticles } from '../extract'
import { classifyBody, fetchViaJina } from '../jina'
import type { Adapter, ArticleBody } from './index'
import type { Article, Source } from '../types'

export const jinaAdapter: Adapter = {
  async fetchHomepage(source: Source): Promise<Article[]> {
    const result = await fetchViaJina(source.url)
    return extractArticles(result.markdown, source.url)
  },
  async fetchArticleBody(_source: Source, article: Article): Promise<ArticleBody> {
    const result = await fetchViaJina(article.url)
    const classification = classifyBody(result.markdown)
    if (!classification.ok) {
      const reason = classification.reason
      const message =
        reason === 'paywall'
          ? 'This article appears to be behind a paywall. Open it in your browser to read the full text.'
          : reason === 'bot-wall'
            ? 'This site blocks automated access. Try a different source.'
            : 'Article body looks empty — extraction may have failed.'
      return { title: result.title || article.title, body: message, classification: reason }
    }
    return { title: result.title || article.title, body: result.markdown }
  },
  // Mostly informational — the homepage URL is what the user enters.
  homepageUrlForDisplay(source: Source): string {
    return source.url
  },
}
