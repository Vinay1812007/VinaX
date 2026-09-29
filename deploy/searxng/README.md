# VinaX web search — self-hosted SearXNG

Owner / operator document. This folder runs the SearXNG metasearch instance
that VinaX 8.3 uses for web search:

- VinaX AI research answers (the Web search / Research toggle, and the
  engine's own "search the web" step): SearXNG results lead, the older keyless
  sources are the fallback;
- the Search page's music expert: fresh song results ground its suggestions;
- the AI DJ and AI Playlist: current releases for discoveries when the
  flagship engine is unavailable or the listener asks for new / trending music;
- the trends job: a `web` source of songs people are uploading and talking
  about this week (every match waits for your review in the console).

Listeners never see the name; the app calls it "web search". Nothing breaks
while it is not set up: every feature above keeps its previous behaviour.

## What is in the folder

| File | What it is |
| --- | --- |
| `docker-compose.yml` | Two containers with pinned image tags: `searxng` (internal only, no capabilities, a health check) and `proxy` (ports 80/443, automatic HTTPS; starts once SearXNG is healthy) |
| `settings.yml` | SearXNG settings: the JSON API only, short upstream timeouts, its own limiter off (the proxy guards the door) |
| `proxy.conf` | The proxy's config: forwards only `GET /search` and `GET /healthz`, and only with the VinaX token; its access log never records the search words |
| `.env.example` | The three values you fill in (`SEARXNG_HOSTNAME`, `SEARXNG_SECRET`, `SEARXNG_TOKEN`) |

Why a token: a public SearXNG with the JSON API on is an open search proxy
that anyone can script against, and a busy one gets its upstream engines
blocked. The proxy answers `401` to any `/search` request without
`Authorization: Bearer <SEARXNG_TOKEN>` and `404` to every other path, so only
the VinaX Worker can use the instance. SearXNG's own limiter is off on
purpose: its bot detection would block the Worker (datacenter addresses, no
browser headers), and the token already keeps everyone else out.

## 1. Run it

You need a small Linux server (1 vCPU and 1 GB RAM are enough) with Docker
and the compose plugin, a DNS name for it (an `A`/`AAAA` record, e.g.
`search.example.org`), and ports 80 and 443 open to the internet (the proxy
needs them to obtain the HTTPS certificate).

```sh
# on the server, from a copy of this folder
cp .env.example .env
openssl rand -hex 32   # paste as SEARXNG_SECRET
openssl rand -hex 32   # paste as SEARXNG_TOKEN — keep it; the Worker needs the same value
nano .env              # also set SEARXNG_HOSTNAME=search.example.org (no scheme, no slash)
chmod 600 .env
chmod 644 settings.yml proxy.conf   # the containers must be able to read them
docker compose up -d
docker compose logs -f   # wait for the certificate to be issued, then Ctrl-C
```

`docker compose up` stops with a clear message if any of the three values is
missing. SearXNG itself refuses to start without `SEARXNG_SECRET`.

`settings.yml` must stay readable by the container. The SearXNG image runs its
server as root but, in this compose file, with every capability dropped — so
it reads files only through their "other" permission bits, not as a
superuser; the image's own `searxng` user is uid 977 if you ever run it as
that user. A `settings.yml` with mode 600 owned by your login (a common
result of copying it with a restrictive umask) is unreadable to it, and
SearXNG exits at start. `chmod 644 settings.yml` fixes it; the file holds no
secret (the real secret comes from `.env`).

## 2. Check it from your machine

```sh
H=https://search.example.org
T=<your SEARXNG_TOKEN>

# 401 — no token, the door is shut
curl -s -o /dev/null -w '%{http_code}\n' "$H/search?q=telugu+songs&format=json"

# 200 and a result count — this is exactly what the Worker sends
curl -s -H "Authorization: Bearer $T" \
  "$H/search?q=latest+telugu+songs&format=json&categories=videos&time_range=week" \
  | jq '.results | length'

# which upstream engines failed on that query (a few is normal)
curl -s -H "Authorization: Bearer $T" "$H/search?q=telugu+songs&format=json" | jq '.unresponsive_engines'
```

If the second command prints a `jq` parse error instead of a number, look at
the status: SearXNG answers `403 Forbidden` when the JSON format is off —
check that `search.formats` in `settings.yml` lists `json`, then
`docker compose up -d searxng`. A `401` means the token does not match.

## 3. Point the VinaX Worker at it

From `backend/`:

```sh
# the token — always a secret
npx wrangler secret put SEARXNG_TOKEN --config worker/wrangler.toml

# the address — either a plain var in worker/wrangler.toml [vars]:
#   SEARXNG_URL = "https://search.example.org"
# (then deploy), or, to keep the hostname out of the repository, a secret:
npx wrangler secret put SEARXNG_URL --config worker/wrangler.toml
```

Pick ONE of the two for `SEARXNG_URL`, and never the dashboard:

- **Secret or var, not both.** Once `SEARXNG_URL` is a secret, uncommenting
  the `SEARXNG_URL` line in `worker/wrangler.toml` makes the next deploy fail
  ("binding name already in use"). To switch to the var, first
  `npx wrangler secret delete SEARXNG_URL --config worker/wrangler.toml`.
- **Not a dashboard variable.** A plain variable added in the Workers
  dashboard is wiped by the next deploy from GitHub Actions (the deploy does
  not keep dashboard vars), and web search silently switches off. Secrets
  survive deploys; so does a var in `wrangler.toml`.

`SEARXNG_URL` must be `https://` (plain `http://` is accepted only for
`localhost`, for local development). A trailing slash is fine; a user name,
password or query string makes the Worker ignore it.

For local development put both in `backend/worker/.dev.vars`:

```text
SEARXNG_URL=http://localhost:8888
SEARXNG_TOKEN=
```

(an empty token sends no header, which suits a local instance without the proxy).

## 4. Check it from the Worker

- **Owner console → Technical → System health**: the row "Web search engine"
  shows the result count and latency of a small query, or why it failed
  (`not configured`; `invalid address` — set, but not `https://`, or with a
  user name, password or query; `token refused — check SEARXNG_TOKEN` for a
  `401`; `forbidden — check that search.formats in settings.yml includes json`
  for a `403`; `timed out`; `network error`; `resting after <that failure>
  (retries in about N min)`). The row never shows the address or the token.
- **Worker logs** (`npx wrangler tail --config worker/wrangler.toml`): one line
  per call, e.g.
  `[searxng] expert q="telugu rainy day melodies songs" cat=videos,music status=ok http=200 n=20 ms=1289`.
  At most 60 characters of the query are logged; never the URL or the token.
- **Trends**: run the web source once by hand and look at the review queue in
  the console's Trends panel:

  ```sh
  curl -s -X POST -H "x-cron-secret: $CRON_SECRET" \
    "https://www.sirimillavinay.online/api/cron/trends-ingest?source=web" | jq '.runs'
  ```

## How the Worker uses it (and what happens when it is down)

- Every call has a ~5 s leash (3.5 s for the Search expert, 4 s for the DJ and
  playlist context, 6 s per trends query) and a result cap, and asks the
  instance to answer inside it (`timeout_limit`, the leash less 0.7 s; with
  `max_request_timeout: 3.0` in `settings.yml` the instance never waits longer
  than 3 s). The DJ and playlist wait for web context at most about a second
  beyond their other work, and reuse an answer for the same search for 15
  minutes.
- After a failure that says the instance is unwell — a network error, a 5xx
  or `429`, a `403` (JSON format off), an answer that is not JSON, or no answer
  within the full 5 s leash — the Worker leaves the instance alone for 60 s in
  that isolate; after a `401` (token refused) for 10 minutes. During that time
  every feature behaves as if it were not configured — nothing waits on a
  dead instance. A caller that gave up early on its own shorter leash does
  not rest it for everyone else.
- Results are handed to the AI engines as fenced, untrusted data. Nothing a
  result says is played: every suggested song is still looked up in the
  catalogue, and trend items only reach listeners after you accept them.

## The trends source

`TRENDS_WEB_LANGUAGES` (Worker var, comma-separated, default
`telugu,hindi,tamil`, at most five) picks the languages. Each run searches
"new <language> songs" and "trending <language> songs this week" in the video
category for the last week, keeps results that look like one song's upload
(titles such as "Song | Film | Cast | Composer"; playlists, jukeboxes, top-10
lists, trailers and non-music are dropped), merges mentions across searches
and matches each to a catalogue song with the same matcher the video chart
uses. **Every match is filed for review, even a confident one**; accepted
songs show under the label `TRENDS_WEB_LABEL` (default "New on the web") for
72 hours after each sighting. `TRENDS_DISABLED_SOURCES=web` switches the
source off.

## Maintenance

```sh
docker compose pull && docker compose up -d   # after changing the pinned tags
docker compose ps                             # searxng should say (healthy)
docker compose logs --tail=100 searxng        # engine errors, CAPTCHAs
```

The proxy's access log records each request without its search words (the
`q` parameter is removed before the line is written) and never the token.

- **Rotate the token** without a gap. A refused token rests the instance for
  10 minutes in every Worker isolate that sees it, so the proxy accepts the
  old and the new token while you switch:
  1. On the server, in `.env`: move the current value to
     `SEARXNG_TOKEN_PREVIOUS=<old token>` and set
     `SEARXNG_TOKEN=<new token>` (`openssl rand -hex 32`); then
     `docker compose up -d proxy`. Both tokens now work.
  2. From `backend/` on your machine:
     `npx wrangler secret put SEARXNG_TOKEN --config worker/wrangler.toml`
     with the new value. The Worker uses it from its next request.
  3. After a few minutes (the health row shows results again), delete the
     `SEARXNG_TOKEN_PREVIOUS` line and `docker compose up -d proxy`: only the
     new token works.
  Skipping step 1's `SEARXNG_TOKEN_PREVIOUS` still works, but between the two
  changes the health row says the token was refused and features fall back
  (for up to 10 minutes after the Worker has the new token).
- **Update the images**: both are pinned in `docker-compose.yml`. Pick newer
  tags (`searxng/searxng` publishes `YYYY.M.D-<commit>` tags, the proxy
  `2.<minor>-alpine`), edit them, then run the two commands above. Check
  System health afterwards.
- **Engines blocked**: upstream engines sometimes answer with a CAPTCHA; SearXNG
  suspends that engine for a while and the others carry on
  (`search.suspended_times` in SearXNG's defaults). A server with a clean
  address and low traffic rarely hits this.
- **Never publish port 8080** of the `searxng` container. Only the proxy may
  reach it.
