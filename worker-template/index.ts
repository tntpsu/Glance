// Glance personal Cloudflare Worker — extract clean article text from
// auth-walled sites that r.jina.ai can't reach (Rivals, NYT-with-account,
// paid forums, etc.). Each user deploys their own copy with their own
// session cookies — Glance never sees the cookies, and the Worker is
// only reachable with the bearer token you choose.
//
// Endpoints:
//   GET /reader?url=<encoded-url>
//     Headers: Authorization: Bearer <SHARED_SECRET>
//     Returns: { ok: true, title: string, body: string }
//          or: { ok: false, error: string }
//
// Cookies for target sites are configured via Worker env vars in
// wrangler.toml: e.g. `COOKIES_RIVALS_COM = "PHPSESSID=xyz; user=abc"`.
// Match by hostname; the Worker uses any cookie env var whose name maps
// to the request URL's hostname.
//
// Deploy with: wrangler deploy (after running `wrangler login` and
// editing wrangler.toml). Free tier covers ~100k requests/day, way more
// than any single user will hit.

import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
// Swap from jsdom to linkedom (v0.5.5 deploy fix). jsdom pulls node
// built-ins (path/fs/url/etc) that don't exist in Cloudflare Workers
// even with nodejs_compat — linkedom is a pure-JS DOM impl that works
// in Workers natively. Readability accepts any Document-shaped object.

interface Env {
  SHARED_SECRET: string
  // Cookie env vars are dynamically named: COOKIES_<HOST_WITH_UNDERSCORES>
  // We read them via [key] indexing rather than a fixed shape.
  [key: string]: string | undefined
}

function cookieKeyForHost(host: string): string {
  // www.bwi.rivals.com → COOKIES_WWW_BWI_RIVALS_COM
  return 'COOKIES_' + host.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // v0.5.5: log every request so `wrangler tail` shows what's actually
    // arriving (vs what the plugin claims it's sending). Catches the
    // class of bug we hit on Cue where Cloudflare WAF or WebView mangled
    // the method en route — debugging took hours without this.
    // eslint-disable-next-line no-console
    console.log(`[req] ${request.method} ${new URL(request.url).pathname} ua=${(request.headers.get('user-agent') ?? '').slice(0, 60)}`)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }
    const url = new URL(request.url)
    // v0.5.5: /healthz for monitoring + /diag echoes the request back so
    // the plugin can verify what actually arrived at the worker.
    if (url.pathname === '/healthz') {
      return jsonResponse(200, { ok: true })
    }
    if (url.pathname === '/diag') {
      const headerKeys: string[] = []
      request.headers.forEach((_v, k) => headerKeys.push(k))
      return jsonResponse(200, {
        ok: true,
        method: request.method,
        url: request.url,
        headers: headerKeys,
        cfRay: request.headers.get('cf-ray') ?? null,
        cfCountry: ((request as unknown as { cf?: { country?: string } }).cf)?.country ?? null,
        ua: request.headers.get('user-agent'),
      })
    }
    if (url.pathname !== '/reader') {
      return jsonResponse(404, { ok: false, error: 'not found' })
    }

    // Authenticate.
    const auth = request.headers.get('Authorization') ?? ''
    const expected = `Bearer ${env.SHARED_SECRET}`
    if (!env.SHARED_SECRET || auth !== expected) {
      return jsonResponse(401, { ok: false, error: 'unauthorized' })
    }

    const target = url.searchParams.get('url')
    if (!target) return jsonResponse(400, { ok: false, error: 'url required' })

    let targetUrl: URL
    try {
      targetUrl = new URL(target)
    } catch {
      return jsonResponse(400, { ok: false, error: 'invalid url' })
    }
    if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
      return jsonResponse(400, { ok: false, error: 'http(s) only' })
    }

    // Look up cookies for this hostname (and parent domains).
    const cookieParts: string[] = []
    const candidates = [targetUrl.hostname, targetUrl.hostname.replace(/^www\./, '')]
    for (const host of candidates) {
      const key = cookieKeyForHost(host)
      const value = env[key]
      if (value) cookieParts.push(value)
    }
    const cookieHeader = cookieParts.join('; ')

    // Fetch with cookies + a realistic UA so sites don't bot-wall us.
    const upstream = await fetch(target, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        Accept: 'text/html,application/xhtml+xml',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      redirect: 'follow',
    })
    if (!upstream.ok) {
      return jsonResponse(upstream.status, {
        ok: false,
        error: `upstream HTTP ${upstream.status}`,
      })
    }
    const html = await upstream.text()

    // Extract via Mozilla Readability.
    let title: string
    let body: string
    try {
      const { document } = parseHTML(html)
      // Readability needs a baseURI; linkedom's document doesn't auto-set
      // it, so set it via a base element if Readability needs absolute URLs.
      const reader = new Readability(document as unknown as Document)
      const parsed = reader.parse()
      if (!parsed) {
        return jsonResponse(500, { ok: false, error: 'extraction returned nothing' })
      }
      title = parsed.title || targetUrl.hostname
      body = parsed.textContent?.trim() || ''
    } catch (err) {
      return jsonResponse(500, {
        ok: false,
        error: `extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
    if (!body || body.length < 100) {
      return jsonResponse(200, {
        ok: false,
        error: 'extracted body looks empty — site may have changed structure',
      })
    }

    return jsonResponse(200, { ok: true, title, body })
  },
}
