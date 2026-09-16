# VinaX 6.4 — personalization pipeline audit and completion

The brief asked for eight capabilities (AI DJ, AI Home builder, next-song engine, taste profile, language-aware personalization, session mood/energy, anti-repeat + diversity, AI fallback) built on the existing architecture, not from scratch. The uploaded archive was not present on disk; the audit ran against this repository at `main` after 6.1–6.3 were merged.

## Audit — what already existed vs. what 6.4 added

| Brief point | State before 6.4 | 6.4 change |
| --- | --- | --- |
| Files listed for inspection | `engine.ts`, `scoring.ts`, `profile.ts`, `updater.ts`, `playerStore.ts` present; `ai/dj.ts` present (6.2); `ai/home.ts` and `useAiHome.ts` absent (logic lived in `useAiHomeShelves.ts`) | `services/ai/home.ts` and `features/home/useAiHome.ts` created; `useAiHomeShelves.ts` kept as a re-export |
| Taste profile (§3) | languages, artists, hour histogram, language × 6-hour bucket, recent/skipped/liked ids, soft-mutes, four taste dials | + per-song affinity (capped 300), weekday histogram, running energy preference (all optional fields, old profiles load unchanged) |
| Event weights (§4) | play 1 / complete 2 / favourite 3 / queue-add 0.5 / skip −0.75, hard-coded at call sites | `eventWeights.ts`: one frozen table + `MAX_AFFINITY` cap so no event dominates |
| Decay (§5) | 14-day positive / 30-day skip half-lives inside `applyDecay` | `applyTimeDecay(profile, now, halfLives)` and pure `getDecayedAffinity(affinity, now)`; song affinities decay too |
| Language-aware (§6, §12) | pinned/muted/affinity/time-of-day weights; hard seed-language lock on continuation | sequencer `languagePolicy: 'lock' \| 'prefer'`; Explore mode allows a single familiar-language detour, never two in a row |
| Session context (§7) | time of day, vibe, weekday, weekend, listener energy text, festival | + `sessionState` enum, `recentSkipCount`, `recentCompletionRate`, `sessionDurationMin`, `recentLanguage`, `recentArtist` — flows into DJ context, taste snapshot and Home builder |
| AI DJ (§8–9) | pool-only selection by title + artist; 14 s client leash, 16 s server budget | pool entries carry ids; model returns `songId` + `confidence`; id validated against the pool, title/artist fallback, never trusted alone; 12 s client leash, 12 s server budget |
| Local engine (§10–11) | scoring with configurable weights, MMR reranker, arc sequencer | + song affinity, weekday and energy-preference terms with reason kinds `song` / `day`; weights version 1.1.0 |
| Anti-repeat (§13) | recent ids, served keys, DJ surfaced (300), shelf titles (30) | + last 200 songs shown on AI shelves, excluded from the next build |
| Queue extension / radio (§14–15) | `≤ 2` remaining → append 8; `startRadio` | unchanged (verified by existing tests) |
| AI Home (§16–18) | title/query/why shelves, half-day cache, title memory | typed definitions `{title, description, query, reason, type}`, per-load visit nonce, song memory |
| Taste dials (§19) | adventurous / recency / energy / vocalness, persisted, used by scorer + AI payloads | unchanged |
| Provider compatibility, secrets (§20) | lane router with ladders; keys server-side only | unchanged; DJ rides `dj → chat → fast → scholar → home` |
| Caching, errors, privacy (§22–23, §26) | react-query caches, AI metadata cache, DJ back-off, 503 disables; titles/artists only | unchanged |
| Debug mode (§25) | `?debug=recs` showed one reason line per card | `store/recsDebugStore.ts` + `features/recommendation/RecsDebugPanel.tsx`: per-recommendation final score, every component, source, AI-selected vs local fallback, DJ confidence; mounted only when enabled |
| New-user behaviour (§28) | trending/popular/language shelves, onboarding seed, cold-start blend | unchanged |

## Runtime flow

```
USER LISTENS (play / skip / complete / favourite / queue-add)
   ↓ updater.ts — EVENT_WEIGHTS, capped, decayed
PROFILE LEARNS (languages, artists, songs, hours, weekdays, energy, dials)
   ↓ taste.ts snapshot + sessionContext.ts (sessionState, counters)
HOME PERSONALIZES (services/ai/home.ts designs shelves → catalogue resolves → anti-repeat)
   ↓
CURRENT SONG CREATES CONTEXT (context.ts: profile, session vector, festival, region)
   ↓ candidates.ts (60–100 real songs) → gates → scoring.ts → reranking.ts → sequencer.ts (arc, language policy)
AI DJ + LOCAL ENGINE (dj.ts: 25–40 pool → songId + reason + confidence → validated; local order on any failure ≤ 12 s)
   ↓
NEXT SONG (queue extension at ≤ 2 remaining; radio from a single song)
   ↓
USER BEHAVIOUR (transition memory, adaptive re-plan on two skips)
   ↓
PROFILE UPDATES
```

## Verification (2026-09-16)
- Frontend: lint ✓, typecheck ✓, unit tests ✓ (**608 tests in 99 files**; new suites: event weights and decay, session state, language policy, DJ id resolution, home builder types and song memory, debug store), production build ✓.
- Backend: lint ✓, typecheck ✓, tests ✓ (**207 tests in 29 files**, DJ id contract included).
- Browser suite (mocked APIs, real Chromium): **39 tests in 10 files pass**. Bundle-size gate: red for the pre-existing reason (UPGRADE_6_1.md); first-load 184.7 KB.

## Known limitations
- Energy for songs without classifier metadata is a keyword estimate.
- Transition memory and song affinity start empty and improve only with listening.
- The debug panel is opt-in via query string / localStorage and on in dev builds; it is never shipped on by default.
