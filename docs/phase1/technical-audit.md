# Technical Audit — VinaX v16.82 (2026-07-08)

## 1. Stack inventory

| Layer | Technology |
|---|---|
| UI | React 18 + TypeScript (strict), Vite 5.4, Tailwind with CSS-variable tokens |
| State | Zustand (14 stores, persisted via localStorage) + TanStack Query (server cache) |
| Routing | React Router 6, file-per-page (43 page components) |
| Hosting | Cloudflare Pages (auto-deploy on push to `main`) |
| Server | Cloudflare Pages Functions — 51 TS files, 3,720 LOC (AI lanes, rooms, admin, sitemaps, edge entity rendering) |
| Data | Supabase Postgres via REST (8 tables, 20 RPCs, idempotent schema in `supabase/schema.sql`) |
| AI | NVIDIA NIM (4 key lanes → gpt-oss-120b / gpt-oss-20b / nemotron-3-super ×2 lanes / gemma-3n-e4b) with cross-lane failover |
| Catalog | saavn.dev upstream (search, suggestions, launch/browse modules) via typed client service |
| Native | Capacitor Android (APK built per push by CI) |
| Tests | vitest — 53 tests / 13 files |

## 2. Baseline metrics (captured 2026-07-08)

| Metric | Value | Gate |
|---|---|---|
| First-load JS (gz) | **144.0 KB** (index 64.7 + vendor 63.9 + data 15.4) | CI budget 150 KB |
| First-load chunk cap | 80 KB each | CI |
| Lazy chunk cap | 160 KB (diagram libs exempt) | CI |
| Prerendered routes | 28 (unique head + JSON-LD) | build |
| src LOC | 21,089 (`.ts`/`.tsx`) | — |
| Functions LOC | 3,720 | — |
| Dependencies | 16 runtime / 19 dev | — |
| Tests | 53 passing | CI |
| Lighthouse | dedicated workflow per push (green on v16.82) | CI |
| CI wall time | ~1 min (lint + typecheck + tests + build + budget) | — |

## 3. Route inventory (34 static + hubs + entities)

Static: home, discover, charts, made-for-you, ai-playlist, weekly, mixes, search, library,
favorites, history, queue, now-playing, languages, explore, movies, moods, regions,
taste-profile, settings, cache-info, about, privacy, terms, contact, dmca, help, stats,
offline, together, karaoke, quiz, download, drive, VinaXAI.
Hubs: 12 language pages (`/{lang}-songs`). Entities: `/song/:slug-:id`, `/album/…`,
`/artist/…`, `/playlist/…`, `/lyrics/:id`, `/collection/:id`. Plus `/admin` (static vanilla-JS app).

## 4. Rendering strategy (as-built)

Three complementary modes: (1) build-time prerender for 28 marketing/hub routes;
(2) **edge rendering** for entity URLs — Pages Functions fetch the entity and inject real
title/description/OG/JSON-LD into the shell; (3) client SPA for the player and all
interactive surfaces. Service worker: network-first navigations, cache-first hashed assets.

## 5. Delivery hardening (post-incident, July 2026)

- `/assets/*` never falls back to SPA HTML (404 guard in `_redirects`) — prevents
  immutable-cache poisoning (root cause of the July 7 outage).
- Asset URL epoch (`b2` in filenames) — bulk cache bypass lever; bump to `b3` to invalidate the world.
- Boot self-healing: entry-chunk retry + `vite:preloadError` reload + sw revalidation.

## 6. Dead code & debt

- `src/components/AssistantSheet.tsx` — no longer reachable from UI (Settings card removed
  v16.77; Search entry now routes to `/VinaXAI`). Candidate for deletion in Phase 3 after
  confirming no deep links.
- Legacy token layers in `index.css` (green flat theme, Aura cyan layer) are shadowed by the
  Noir Bloom layer — consolidate in Phase 3 to cut CSS weight.
- `extractAverageColor` and `extractVibrantColor` overlap; unify in Phase 3.
- Wikipedia search engine removed from VinaX AI (DDG only) — dead branches gone, but
  `BRAVE_API_KEY` upgrade path is untested in production.

**Resolution (v16.87):** AssistantSheet deleted; color extractors unified behind one
pixel loader; legacy CSS token layers remain shadowed (harmless, ~2 KB gz) — accepted.

## 7. Known operational risks

- NIM latency spikes (25–47 s observed on the 120b lane) — mitigated by 12 s client deadline
  + local fallback, but tune/DJ quality degrades silently when AI is slow.
- Upstream catalog (saavn.dev) is a single point of failure; no SLA. Multi-source failover
  exists at the audio layer only.
- Supabase free tier limits (rooms polling every 2 s per guest) — fine at current scale,
  needs revisiting past ~200 concurrent rooms.

## 8. Phase 2 gap list (engine room is otherwise production-grade)

1. Media Session API coverage audit (lock-screen controls on Android WebView + iOS Safari).
2. Gapless/crossfade correctness under network drop (recovery exists; add automated test).
3. Formal `Movie` model (currently inferred from album names — see catalog audit §3).
4. Query-layer pagination consistency (some shelves fetch fixed pages).
