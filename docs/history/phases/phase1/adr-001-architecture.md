# ADR-001 — Target Architecture

**Status:** Accepted · 2026-07-08 · Owner: Vinay (via rebuild plan) · Author: engineering

## Context

The rebuild plan asks for a framework/rendering/state decision. The existing system
(React 18 + Vite SPA on Cloudflare Pages, Pages Functions server layer, prerender + edge
entity rendering, Zustand + TanStack Query) already meets the plan's stated goals: SSR/SSG
for hubs, client-driven player, typed data boundary, CI-enforced budgets (144 KB gz
first-load), Lighthouse workflow green, 53 tests.

## Decision

**Evolve in place. No framework migration.**

1. **Framework:** stay on React 18 + TypeScript + Vite. A Next.js/Remix rewrite would spend
   Phases 2–3 re-earning parity (routing, player persistence across navigation, budgets)
   for zero user-visible gain and would re-open every stabilized bug.
2. **Rendering:** keep the three-mode hybrid — build-time prerender (28 hub/marketing
   routes) + edge entity rendering (song/album/artist/playlist heads + JSON-LD at the CDN)
   + client SPA for the player. This IS the "SSR/SSG for hubs, client for player" target.
3. **State:** Zustand stores (persisted, on-device) for domain state; TanStack Query for
   server cache; no global framework change. Player remains a single global instance
   mounted in the layout (survives all navigation).
4. **Data boundary:** all catalog access flows through `src/services/api/*` typed clients;
   all secrets/AI/DB behind Pages Functions (`functions/`). Client never holds keys.
5. **Data model:** as documented in the catalog audit; one addition ordered — a formal
   `Movie` projection over albums (Phase 2).
6. **Platform:** Cloudflare Pages + Functions + Supabase + NIM stay. Delivery hardening
   (asset 404 guard, URL epoch, self-healing boot) is now part of the platform contract.

## Consequences

- Phases 2–3 become gap-closing + surface-polish passes on a running product, releasable
  continuously (the plan's phase gates map to checklists, not big-bang cutovers).
- The riskiest phase (data/playback rewrite) is avoided; regression risk concentrates in
  CSS/UX work, which ships behind the existing gates.
- If a future requirement demands true streaming SSR (e.g. logged-in feeds — currently
  forbidden by the privacy promise), revisit in a new ADR.
