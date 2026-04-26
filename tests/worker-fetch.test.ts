// Unit tests for worker-fetch.ts. Mocks fetch globally — verifies the
// request shape (auth header, URL encoding) and the response handling
// (success, HTTP errors, network errors, malformed JSON).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchViaWorker } from '../src/worker-fetch'

const ORIGINAL_FETCH = globalThis.fetch

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

describe('fetchViaWorker', () => {
  it('encodes the URL and sends bearer auth', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ ok: true, title: 'Hi', body: 'Lorem ipsum' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const result = await fetchViaWorker(
      'https://glance-reader.example.workers.dev',
      'secret-token',
      'https://news.example.com/article?id=42&utm=foo',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.title).toBe('Hi')
      expect(result.body).toBe('Lorem ipsum')
    }
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe(
      'https://glance-reader.example.workers.dev/reader?url=https%3A%2F%2Fnews.example.com%2Farticle%3Fid%3D42%26utm%3Dfoo',
    )
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret-token')
  })

  it('strips trailing slash from worker URL', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ ok: true, body: 'x', title: 't' }),
      { status: 200 },
    ))
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    await fetchViaWorker('https://w.example.com/', 'tok', 'https://a.com')
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://w.example.com/reader?url=https%3A%2F%2Fa.com')
  })

  it('returns error result on HTTP 401', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )) as unknown as typeof fetch
    const r = await fetchViaWorker('https://w.example.com', 'wrong', 'https://a.com')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('unauthorized')
      expect(r.workerStatus).toBe(401)
    }
  })

  it('returns error result when worker returns ok:false', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ ok: false, error: 'extraction failed' }),
      { status: 200 },
    )) as unknown as typeof fetch
    const r = await fetchViaWorker('https://w.example.com', 'tok', 'https://a.com')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('extraction failed')
  })

  it('returns error result with workerStatus -1 on network failure', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const r = await fetchViaWorker('https://w.example.com', 'tok', 'https://a.com')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.workerStatus).toBe(-1)
      expect(r.error).toMatch(/Failed to fetch/)
    }
  })

  it('handles missing body even with ok:true', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ ok: true, title: 'x' }),
      { status: 200 },
    )) as unknown as typeof fetch
    const r = await fetchViaWorker('https://w.example.com', 'tok', 'https://a.com')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('no body')
  })
})
