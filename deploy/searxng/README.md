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
| `docker-compose.yml` | Two containers: `searxng` (internal only) and `proxy` (ports 80/443, automatic HTTPS) |
| `settings.yml` | SearXNG settings: the JSON API on, short upstream timeouts, its own limiter off (the proxy guards the door) |
| `proxy.conf` | The proxy's config: forwards only `GET /search` and `GET /healthz`, and only with the VinaX token |
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
docker compose up -d
docker compose logs -f   # wait for the certificate to be issued, then Ctrl-C
```

`docker compose up` stops with a clear message if any of the three values is
missing. SearXNG itself refuses to start without `SEARXNG_SECRET`.

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

If the second command prints HTML instead of a number, the JSON format is off:
check that `search.formats` in `settings.yml` lists `json` and restart.

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
  (`not configured`, `token refused — check SEARXNG_TOKEN`, `JSON format is
  off on the instance`, `timed out`, `resting after a recent failure`). The
  row never shows the address or the token.
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
  playlist context, 6 s per trends query) and a result cap.
- After any failure (timeout, network error, 5xx, HTML instead of JSON) the
  Worker leaves the instance alone for 60 s in that isolate; after a `401` /
  `403` for 10 minutes. During that time every feature behaves as if it were
  not configured — nothing waits on a dead instance.
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
docker compose pull && docker compose up -d   # update both images
docker compose logs --tail=100 searxng        # engine errors, CAPTCHAs
```

- **Rotate the token**: new value in `.env`, `docker compose up -d proxy`,
  then `npx wrangler secret put SEARXNG_TOKEN` with the same value. Until both
  match, the health row says the token was refused and features fall back.
- **Engines blocked**: upstream engines sometimes answer with a CAPTCHA; SearXNG
  suspends that engine for a while and the others carry on
  (`search.suspended_times` in SearXNG's defaults). A server with a clean
  address and low traffic rarely hits this.
- **Never publish port 8080** of the `searxng` container. Only the proxy may
  reach it.
