// Shared helper for fetching an article body via a user-deployed Cloudflare
// Worker (worker-template/index.ts). Used by:
//   - workerAdapter (per-source paywall config — bound to one site)
//   - jinaAdapter (default Worker — universal extractor when configured)
//
// The Worker contract is `GET /reader?url=<encoded>` with bearer auth,
// returning `{ ok, title, body }` or `{ ok: false, error }`. See
// worker-template/index.ts for the full spec.

const FETCH_TIMEOUT_MS = 15_000

export interface WorkerFetchResult {
  ok: boolean
  title?: string
  body?: string
  error?: string
  // HTTP status of the worker response (not the upstream site). Lets the
  // caller distinguish "worker unreachable" (-1) from "worker reached but
  // returned an error" (>=400) for fallback decisions.
  workerStatus: number
}

export async function fetchViaWorker(
  workerUrl: string,
  bearerToken: string,
  articleUrl: string,
): Promise<WorkerFetchResult> {
  const base = workerUrl.replace(/\/$/, '')
  const target = `${base}/reader?url=${encodeURIComponent(articleUrl)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(target, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    })
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`
      try {
        const j = (await resp.json()) as { error?: string }
        if (j?.error) msg = j.error
      } catch { /* ignore */ }
      return { ok: false, error: msg, workerStatus: resp.status }
    }
    const json = (await resp.json()) as { ok: boolean; title?: string; body?: string; error?: string }
    if (!json.ok || !json.body) {
      return { ok: false, error: json.error || 'no body', workerStatus: resp.status }
    }
    return { ok: true, title: json.title, body: json.body, workerStatus: resp.status }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      workerStatus: -1,
    }
  } finally {
    clearTimeout(timer)
  }
}
