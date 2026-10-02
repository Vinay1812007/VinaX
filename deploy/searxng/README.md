# VinaX web search

The search instance behind VinaX AI research answers. One Render web service,
one container: the search engine on loopback, and a proxy in front of it that
refuses any request without VinaX's bearer token.

Where this sits in VinaX:

| Piece | Host |
| --- | --- |
| Frontend | Cloudflare Pages project `vinax` |
| API | Cloudflare Worker `vinax-api` |
| **Web search** | **Render service `vinax-search`** |

The Worker reads two variables. `SEARXNG_URL` is a plain var in
`backend/worker/wrangler.toml`, `SEARXNG_TOKEN` is a Worker secret. With
`SEARXNG_URL` unset there is no second source to fall back to: a research turn
reports that it could not check the live web. That is deliberate — see
`docs/ai.md`.

## Why the proxy is not optional

The engine's own bot limiter has to be off: with it on, its bot detection
blocks the Worker, which calls from datacenter addresses with no browser
headers. So the token check in `Caddyfile` is the only thing between this
instance and anyone who finds the hostname. `start.sh` refuses to boot without
`SEARXNG_TOKEN` for that reason.

Render routes one port to one container, so the proxy runs beside the engine
rather than in front of it as a second container. The engine binds
`127.0.0.1:8080` and is not reachable any other way.

## Set it up

**1. Generate the token.**

```sh
openssl rand -hex 32
```

One value, two places — the Render service and the Worker. They must match or
every search comes back 401.

**2. Create the service.** Render → New → Blueprint → this repository. The
blueprint (`render.yaml` at the repo root) creates `vinax-search`, generates
`SEARXNG_SECRET` by itself, and asks you for `SEARXNG_TOKEN`.

`SEARXNG_SECRET` is the engine's own `server.secret_key`. It is not the token,
it never goes near Cloudflare, and the engine will not start without it.

**3. Check it before involving the domain.**

```sh
curl -s https://<service>.onrender.com/healthz                       # → ok
curl -s -o /dev/null -w '%{http_code}\n' \
     'https://<service>.onrender.com/search?q=test&format=json'      # → 401
curl -s -H "Authorization: Bearer <token>" \
     'https://<service>.onrender.com/search?q=telugu+songs&format=json' | head -c 400
```

The second one answering anything but 401 means the token check is not working.
Stop and fix that first; everything else can wait.

**4. The custom domain.** `search.sirimillavinay.online` is live. Two halves:
add it under Custom Domains on the Render service, and add the DNS record in
Cloudflare:

| Field | Value |
| --- | --- |
| Type | CNAME |
| Name | `search` |
| Target | `vinax-search.onrender.com` |
| Proxy status | **DNS only** (grey cloud) |

Leave it DNS-only. Render issues and renews the certificate itself and cannot
do that through Cloudflare's proxy — with the orange cloud on, Render sees
Cloudflare's addresses and stays stuck on *Waiting for Verification*. Nothing
is lost by not proxying: only the Worker calls this host, and it is not a
public surface.

The service stays reachable at `vinax-search.onrender.com` too, which is
useful when you need to bypass DNS while debugging.

**5. Give the Worker the two values.** The token is a secret:

```sh
cd backend
npx wrangler secret put SEARXNG_TOKEN --config worker/wrangler.toml
```

The URL is not. It belongs in `worker/wrangler.toml` under `[vars]`:

```toml
SEARXNG_URL = "https://search.sirimillavinay.online"
```

Setting that one in the Cloudflare dashboard instead does not stick: a
`wrangler deploy` replaces dashboard plain-text vars with whatever `[vars]`
holds, and the file ships `""`. Secrets are not affected — those survive a
deploy, which is why the two are handled differently.

**6. Deploy the Worker, then look at the console.** Owner console → Health →
**Web search engine**. It reports reachable, result count and latency, or the
failure in plain words:

| What it says | What to do |
| --- | --- |
| `not configured — VinaX AI cannot check the live web` | `SEARXNG_URL` is empty |
| `invalid address — SEARXNG_URL must be https://…` | the value is not a plain https base URL |
| `token refused — check SEARXNG_TOKEN` | the two values do not match |
| `forbidden — check that search.formats in settings.yml includes json` | the engine is not serving JSON |
| `the answer was not JSON …` | something is answering instead of the engine — usually DNS pointing at the wrong place |
| `resting after … (retries in about N min)` | it failed recently and is backing off; the row says why |

## Running it locally

```sh
cp deploy/searxng/.env.example deploy/searxng/.env   # fill in both values
docker build -t vinax-search deploy/searxng
docker run --rm --env-file deploy/searxng/.env -p 10000:10000 vinax-search
```

Then the same three curls as step 3 against `http://localhost:10000`.

## Maintenance

**Engines.** `settings.yml` keeps only google, bing, duckduckgo, wikipedia and
wikidata, and explicitly enables google and bing because SearXNG ships them
`disabled: true` — they run only when a request names them, which is why the
first working deploy returned zero results for everything without an
encyclopedia entry. brave and google cse answer "too many requests" from this
address and qwant serves a CAPTCHA, so they are dropped; duckduckgo times out
consistently but is cheap to keep (benched after one failure) and worth having
if it recovers. As of 2026-10-02 a query returns 17-20 results, google and bing
contributing about ten each.

Re-measure before changing any of that — one engine at a time, and through the
proxy so it is the same path the Worker takes:

```sh
curl -s -H "Authorization: Bearer <token>" \
     'https://vinax-search.onrender.com/search?q=telugu+songs&format=json&engines=google' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["results"]), d["unresponsive_engines"])'
```

**Updating the engine.** `Dockerfile` pins an exact
`YYYY.M.D-<commit>` tag. Change it and redeploy. A build that fails on an
unknown tag means the pin has aged out of the registry; pick a current one.

**Rotating the token.** Set `SEARXNG_TOKEN_PREVIOUS` on Render to the old value
and `SEARXNG_TOKEN` to the new one, deploy, then put the new value on the
Worker with `wrangler secret put`. Remove `SEARXNG_TOKEN_PREVIOUS` once the
Worker has it. Searches keep working throughout.

**The free plan, which this runs on.** It sleeps after about 15 minutes idle
and takes 30-60 s to wake. A research lookup gives up after 6 s, so the first
question after a quiet spell reports that it could not check the live web, and
only the next one works. The reply stays honest — that is what having no
fallback buys — but it is a real gap.

Two ways to close it: move to `starter` in `render.yaml`, or ping `/healthz`
every ~10 minutes from a scheduled job so the service never sleeps. The ping
keeps it awake around the clock, which uses roughly 730 of the 750 free
instance hours a month, so it only works while this is the one free service on
the account.

## Files

| File | What it is |
| --- | --- |
| `../../render.yaml` | the Render blueprint (must live at the repo root) |
| `Dockerfile` | engine image plus the Caddy binary, both pinned |
| `Caddyfile` | the token check, the open `/healthz`, and a log that never records search words |
| `start.sh` | refuses to boot without the two secrets, then runs both halves and takes the container down if either dies |
| `settings.yml` | JSON format on, limiter off, short upstream timeouts |
| `.env.example` | local runs only |
