<div align="center">

# 🎵 VinaX


### Local music catalog development

`npm run dev` now exposes the same `/api/cat/*` catalog handler used by Cloudflare Pages through a Vite development middleware. The browser therefore calls `http://localhost:5173/api/cat/...` instead of community mirrors. The handler talks directly to JioSaavn and also resolves the encrypted media URL for playback.

The local catalog can be tested directly with:

```text
http://localhost:5173/api/cat/search/songs?query=top%20telugu%20songs%202026&limit=5
```

If an existing `VITE_API_BASES` environment variable is set, remove it while testing the built-in local catalog, or set it to `/api/cat`.

### Music tuned to you — free, no login, private by design.

**[▶ Open VinaX](https://www.sirimillavinay.online/)** · **[📱 Android APK](https://www.sirimillavinay.online/download)** · **[🤖 VinaX AI](https://www.sirimillavinay.online/VinaXAI)**

**Release line: VinaX V5.7**

![release](https://img.shields.io/badge/release-VinaX%20V1-22d3ee)
![status](https://img.shields.io/badge/status-production-22c55e)
![platform](https://img.shields.io/badge/web%20·%20android%20·%20tv-121212)
![accounts](https://img.shields.io/badge/accounts-none-22d3ee)
![privacy](https://img.shields.io/badge/personalization-on--device-a78bfa)

</div>

---

## The idea

A music player for Indian and international music in 12+ languages that treats
listeners like adults: **no account, no login, no paywall, no feature-gating —
ever.** The taste profile, history and favorites live on the device and never
leave it. Personalization is computed locally; AI features receive only a
short, capped, anonymous taste summary.

**The honest part:** there are **no ads anywhere** — not on the website, not
in the Android app, and never in Kid mode. VinaX sets **no tracking cookies of
its own**, and nothing about your listening is ever shared with anyone. The
full policy, in plain language, is on the
[privacy page](https://www.sirimillavinay.online/privacy).

## What it does

🏠 **A Home that learns you** — shelves grown from your listening (Continue
Listening, On Repeat, Because You Listened To, Fresh Finds, Hidden Gems, Decade
Rewind, second-language trending), six daily-rotating mood boards, seasonal and
festival shelves, and an endless personalized feed. **Home builder:** every
block can be hidden or reordered from Settings → Home layout. Shelves ride
**VinaX Flow** — language-locked, duplicate-free (one identity per song, no
matter how many catalog copies exist) and never echoing what the queue just
played, vibe-matched to the playing song's mood and today's trends (v5.7.1).
Home redesigns itself on every open: a seeded shelf designer rotates
moods, time-of-day vibes, eras and your top artists, with the AI curating on
top when reachable.

🎧 **Player** — gesture controls, drag-to-reorder queue, synced karaoke lyrics
(romanized + translated + AI "Meaning"), offline downloads that truly work
offline (the whole app pre-caches itself, saved songs play from local blob
storage that never touches the network, the Android app gives Downloads its own bottom-bar tab, and an
offline launch lands straight on the Downloads screen), drive mode, sleep
timer, wake-up alarm, lock-screen controls, tap-the-notification →
full-screen player (Android), tappable credits under the title (composer,
singers, lyricist, film), and *living color*: the app tints itself from
the playing artwork.

🤖 **VinaX AI — the VinaX V5 engine family** — a full chat with all
eighteen engines selectable by name from a scrollable picker (v5.6.1, the owner's key roster): from
**VinaX AUTO** (reads every question and picks the best engine) and the
balanced default through **VinaX NVD NMTRN 3.5 LTNG 30 B** (the big creative
engine that also runs the AI DJ), **VinaX NVD NMTRN SUP** (deepest
reasoning), **VinaX NVD NMTRN ULT** (strongest all-rounder), **VinaX DP V4
PRO** and **DLASH**, **VinaX CGT 20B/120B**, **VinaX GRQ ALL** (music
knowledge in a blink), **VinaX MIMX M3**, **VinaX K3**, **VinaX DIF GEM**,
**VinaX MUSE GMR 30B**, **VinaX GEM 4 31 B**, **VinaX LGNA XS 2.1**, the
**VinaX ING CALBTN** pair and **VinaX TRANSLATE** — the engine nicknames
are the only model names shown anywhere, admin dashboards included, and
feature seats ride only live, probe-verified engines — a dead upstream
model — or a dead key — is benched, never served. The owner-hosted VinaX Saavn
API leads the music sources (v5.6.7), with the first-party catalog as its
fallback — every source health-checked from the admin API monitor. Live web search, files and images,
Think/Research modes, and hands-free voice chat replying in a natural studio
voice. Ask "play ⟨song⟩" and the reply is a live mini-player with lyrics.
Behind the app the same lanes drive the AI DJ, AI playlists and the home
curator — with cross-lane failover so one bad engine never takes a feature
down.

🎚 **Tune this queue** — twelve one-tap intents (melody, beats, devotional,
heartbreak, classics, fresh, language switches, surprise) that reshape what
plays next, with on-device scoring as a fallback so tuning works even when the
AI doesn't.

👥 **Listen Together** — room-code sessions, everyone at the same second
(~1s sync), live shared queue with credits, host controls, "End for all".

⌨️ **Power tools** — Ctrl/⌘+K command palette (jump anywhere, fire player
actions, play songs as you type), a real right-click menu on every song, and
keyboard-first playback.

🔔 **Notifications** — opt-in push, personalized per listener: the daily song
pick comes from *your* language with a message written *in* that language
(device locale first, geography as fallback). At most one song a day plus rare
owner announcements. A bell on Home is the notification center.

📊 **Your VinaX** — on-device stats: plays, hours, top artists, language mix,
🔥 streaks, and a shareable Year-in-Music card painted entirely on your device.

📱 **Everywhere** — installable PWA, auto-updating signed Android APK, TV with
D-pad navigation, capability-based UI (touch/mouse/TV detected by hardware).

## Engineering highlights

- **Stack:** React 19 + TypeScript strict + Vite 8 (Rolldown) · Tailwind token
  system ("Living Glass", user-adjustable glass + blur dials) · Zustand +
  TanStack Query · Cloudflare Pages + Functions (60+ edge modules) · Supabase
  (service-role only, RLS deny-all) · Capacitor 8 · self-hosted Manrope
  variable font.
- **Performance-first shell:** the pre-hydration screen is real, styled
  content (headline + description + navigation) — not a splash — so LCP lands
  at CSS-time; below-the-fold Home blocks mount progressively after first
  paint; zero non-composited animations; 161 KB gz first-load budget enforced
  in CI.
- **A 26-model AI engine across 28 lanes** with cross-lane failover and
  per-lane observability — every lane has its own key and live-probed pinned
  engine (registry in `functions/_lib/models.ts`, keys in `.env.example`),
  all benchable from the admin AI Lab. Feature queues ride **VinaX Flow**: a
  deterministic, catalog-grounded core (language lock, canonical dedup,
  jittered scoring, artist-diverse sequencing, one shared anti-repeat memory)
  with the AI as a pool-only re-ranker that can never invent a song.
- **Release hygiene:** every code change ships with its What's New entry and
  a README touch in the same push — `release.test.ts` enforces that the
  version, `package.json` and the changelog's top entry always move together.
- **Infinite-catalog SEO:** an hourly walker expands the music catalog
  artist-by-artist into a persistent URL corpus (Supabase), served back as
  unbounded paginated sitemaps with canonical-exact URLs; entity pages are
  edge-rendered with real titles, OG cards and JSON-LD, and every render
  feeds newly-discovered entities back into the corpus.
- **Resilient voice:** live voice chat and dictation detect a dead browser
  speech service and fail over to on-device recognition, with honest on-screen
  errors instead of silent hangs.
- **Quality surface:** junk-track filtering on every AI surface, shelf
  diversity caps, design-system auto-tests locking brand tokens, theme
  switching and WCAG contrast into CI.
- **Delivery hardening:** hashed assets can never fall back to HTML, CSP with
  auto-managed script hashes, boot self-healing (a poisoned service worker
  cache unregisters and recovers itself), conservative SW, owner-controlled
  Live/Maintenance switch.
- **Gates on every push:** eslint (0 warnings) → tsc → full vitest suite →
  build + prerender + CSP-hash sync → first-load budget → Playwright E2E +
  axe accessibility → Lighthouse → signed APK build on `[release]`.

## Owner console

`/admin` on a separate subdomain, token-gated: 18 dashboards — real-time
listening, growth chart, search & engagement analytics, world map, user
management with audited deletes and per-user profile export, A/B experiments,
AI-lane health, an AI Lab bench for all seven engines, sent-notification log
with retract, full admin audit trail, content-control blocklist (takedowns
propagate in minutes), weekly digest, push composer with song/album picker,
Live/Maintenance switch, and a ⌘K palette. Light and dark, both legible.

## Repository map

```
src/                the app (43 pages, stores, typed services, design tokens)
functions/          edge: AI lanes · rooms · push · admin · cron · sitemaps · SEO corpus
public/admin/       owner console (vanilla, token-gated)
native-android/     Capacitor media-session bridge (notification → full player)
supabase/           idempotent schema + migrations (paste-and-run SQL)
scripts/            prerender · bundle budget · CSP hashes · android patch
docs/               design system · QA script · release audits · runbooks
.github/workflows/  CI gates · APK release · hourly SEO crawl · daily pushes
```

## Run it

```bash
npm install && npm run dev     # dev server on :5173 — zero secrets needed
npm test                       # vitest (unit + contract tests)
npm run build                  # typecheck + build + prerender + CSP hashes
npx playwright test            # E2E smoke + accessibility gates
```

Deploy: push to `main` — CI gates run, Cloudflare Pages ships web + admin, and
a `[release]` commit additionally publishes a signed Android APK that existing
installs pick up through the in-app updater. Every server secret is documented
in `.env.example` (Cloudflare → Pages → Environment variables); none are
needed locally.

## The promises

1. **Free and login-free, always.** No accounts, no paywalls, no
   feature-gating. Web ads are the only funding, they stay modest, and they
   never enter the Android app or Kid mode.
2. **Private by design.** On-device personalization, opt-in aggregate-only
   analytics, IPs never stored, no VinaX tracking cookies, no data ever shared
   with advertisers. Export or erase everything: Settings → Your Data.

---

<div align="center">Made with ❤️ for listeners who just want to press play.</div>
