# Phase 2 — Core Architecture & Data (gap-closing pass)

Per ADR-001, the engine room already existed at production grade; this phase closed the
audited gaps instead of rewriting.

| Plan item | Status | Evidence |
|---|---|---|
| App shell, routing, tokens, CI | ✅ pre-existing | 43 routed pages, shared layout w/ persistent mini-player, token layer, CI gates |
| Typed models + service layer | ✅ + **Movie added** | `src/types/music.ts` (`Movie`), `src/services/api/movies.ts` (tested parser + projection) |
| Caching + pagination | ✅ + hubs upgraded | TanStack Query everywhere; language hubs now use the shared infinite feed (`useInfiniteSongs`) |
| Loading/error states | ✅ pre-existing | skeletons + per-page error boundary ("wrong note") |
| Playback engine (queue/shuffle/repeat/single instance) | ✅ pre-existing | `audioEngine` singleton + playerStore |
| Media Session API | ✅ **completed** | play/pause/next/prev/seekto (pre-existing) + `seekbackward`/`seekforward` (web + native), positionState |
| Buffering + network-drop recovery | ✅ **now test-locked** | handoff retry policy extracted pure (`recoveryAction`) + unit tests; stall watchdog + source advance pre-existing |

**Exit criteria:** every route navigable in the themed shell ✅ · track plays end-to-end
through the typed layer ✅ · engine production-grade with the recovery rule under test ✅.
