# Glance personal reader Worker

A small Cloudflare Worker that lets Glance read articles from sites that
require login (Rivals, NYT-with-account, paid forums, etc). You deploy
your own copy with your own session cookies — Glance never sees the
cookies, and the Worker is reachable only with a bearer token you choose.

**This is the only piece of Glance that touches your auth state.** It runs
on your Cloudflare account, with your cookies. The main Glance app stays
clean.

## What you'll need

- A Cloudflare account (free) — sign up at https://dash.cloudflare.com
- Wrangler CLI installed locally: `npm install -g wrangler`
- The session cookies for the site(s) you want to read from (next section)

## How to grab session cookies from a site

You need to be logged in via desktop browser, then copy the cookies the
site uses to remember you. **Easiest in Chrome / Edge:**

1. Sign into the site (e.g. `bwi.rivals.com`) in your desktop browser
2. Open DevTools (F12) → Application tab → Storage → Cookies → select the site's domain
3. Look for cookies named like `PHPSESSID`, `session`, `auth`, `token`, `user_id`, etc.
4. Right-click → Copy → "Copy as Header" gives you a one-line `Cookie: name=value; name=value` string
5. Strip the `Cookie:` prefix; you want just the `name=value; name=value` part

Sessions typically last 7-30 days. When the cookies expire (you'll see
"upstream HTTP 403" errors in Glance), repeat the steps and re-deploy.

## Deploy steps

```bash
# 1. clone / copy this directory wherever
cd worker-template
npm install

# 2. authenticate wrangler with your Cloudflare account (one-time)
wrangler login

# 3. set the bearer token Glance will use to call your Worker
#    pick anything random — this is what unlocks your Worker
wrangler secret put SHARED_SECRET
#    (paste a 32+ char random string when prompted)

# 4. set cookie env vars per site you want to read
#    naming pattern: COOKIES_<HOST_WITH_UNDERSCORES_UPPERCASED>
wrangler secret put COOKIES_BWI_RIVALS_COM
#    (paste the cookie string from the steps above)

# 5. deploy
wrangler deploy
```

Wrangler will print your Worker URL — looks like
`https://glance-reader.<your-subdomain>.workers.dev`. Save that and the
SHARED_SECRET; you'll paste both into Glance.

## Hook it up to Glance

In the Glance phone-side settings page:

1. Open the **Add a worker source** form
2. Paste your Worker URL into "Worker URL"
3. Paste your SHARED_SECRET into "Bearer token"
4. Pick a title for the source (e.g. "BWI Rivals")
5. Set the homepage URL of the auth-walled site
6. Save

Glance will now route this source's article extraction through your
Worker, which will fetch with cookies, run Readability, and return the
text. The article-list view still uses the homepage URL for extraction;
the Worker just handles each individual article body.

## Limitations

- **Per-site cookie rotation**: each cookie env var only contains the
  cookies for one site. Set as many as you have sites.
- **JavaScript-rendered sites**: this template does NOT execute JS in
  the headless browser sense. Sites that require JS to render article
  bodies (modern paywalled SPAs) won't work. Most traditional auth-walled
  sites (Rivals, vBulletin / phpBB forums, NYT, etc.) DO work because
  they ship article body in the initial HTML.
- **CORS / security**: the Worker is wide-open to any origin (for
  Glance's WebView to reach it), but gated behind the bearer token. Keep
  the token secret. If it leaks, run `wrangler secret put SHARED_SECRET`
  again with a new value.

## Free-tier limits

Cloudflare Workers free tier: 100,000 requests/day, 10ms CPU per request.
A single user reading 50 articles/day uses ~50 requests. You'd need
hundreds of users to come close to the cap.
