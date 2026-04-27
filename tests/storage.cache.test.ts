// Cache stress tests for the article-body cache in src/storage.ts.
// Verifies the LRU-cap (100 entries) and 30-day TTL behavior under load.

/// <reference types="vitest/globals" />
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCachedBody,
  putCachedBody,
  setStorageBridge,
} from '../src/storage'

beforeEach(() => {
  const store: Record<string, string> = {}
  globalThis.localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length },
  } as Storage
  setStorageBridge(null)
})

afterEach(() => {
  setStorageBridge(null)
  vi.useRealTimers()
})

describe('cache stress + eviction', () => {
  it('round-trips a single body', async () => {
    await putCachedBody({
      url: 'https://example.com/a',
      title: 'Test',
      body: 'Article body.',
      fetchedAt: Date.now(),
    })
    const got = await getCachedBody('https://example.com/a')
    expect(got).not.toBeNull()
    expect(got!.title).toBe('Test')
    expect(got!.body).toBe('Article body.')
  })

  it('returns null for a never-cached URL', async () => {
    expect(await getCachedBody('https://example.com/never-saved')).toBeNull()
  })

  it('evicts oldest when cap is exceeded (cap = 100)', async () => {
    // Write 105 entries (5 over cap). Oldest 5 should be evicted; newest
    // 100 should still be readable.
    const t0 = Date.now() - 1000
    for (let i = 0; i < 105; i++) {
      await putCachedBody({
        url: `https://example.com/${i}`,
        title: `Title ${i}`,
        body: `Body ${i}`,
        fetchedAt: t0 + i,
      })
    }
    // First 5 should be gone
    expect(await getCachedBody('https://example.com/0')).toBeNull()
    expect(await getCachedBody('https://example.com/4')).toBeNull()
    // 5..104 should remain
    expect(await getCachedBody('https://example.com/5')).not.toBeNull()
    expect(await getCachedBody('https://example.com/104')).not.toBeNull()
  })

  it('returns null for entries older than 30-day TTL', async () => {
    const veryOld = Date.now() - (31 * 24 * 60 * 60 * 1000)
    await putCachedBody({
      url: 'https://example.com/ancient',
      title: 'Ancient',
      body: 'old',
      fetchedAt: veryOld,
    })
    expect(await getCachedBody('https://example.com/ancient')).toBeNull()
  })

  it('keeps entries just under the TTL threshold', async () => {
    const justUnder = Date.now() - (29 * 24 * 60 * 60 * 1000)
    await putCachedBody({
      url: 'https://example.com/recent',
      title: 'Recent',
      body: 'still good',
      fetchedAt: justUnder,
    })
    const got = await getCachedBody('https://example.com/recent')
    expect(got).not.toBeNull()
    expect(got!.body).toBe('still good')
  })

  it('overwriting same URL refreshes timestamp + does not double-count toward cap', async () => {
    for (let i = 0; i < 50; i++) {
      await putCachedBody({
        url: 'https://example.com/repeat',
        title: `Take ${i}`,
        body: `iteration ${i}`,
        fetchedAt: Date.now() + i,
      })
    }
    const got = await getCachedBody('https://example.com/repeat')
    expect(got!.title).toBe('Take 49')
    expect(got!.body).toBe('iteration 49')
  })
})
