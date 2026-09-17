# Phase 5 — Hardening, Polish & Launch

| Plan item | Status | Evidence |
|---|---|---|
| Code-splitting / lazy loading / artwork srcset / budgets | ✅ pre-existing | 144 KB gz first-load under 150 KB CI budget |
| Prefetch on intent | ✅ **unblocked this phase** | speculation rules were CSP-dead; `'inline-speculation-rules'` added |
| Boot resilience | ✅ **actually enabled this phase** | self-healing retry script was CSP-blocked in prod; now hash-allowed |
| PWA & offline | ✅ **completed** | installable manifest, offline shell, conservative SW, **artwork cached offline (400-image cap) so Library/Favorites/History browse without a network** |
| Accessibility | ✅ | 44 px targets, focus-visible + TV ring, reduced-motion everywhere, aria labels, toast live regions, skip link |
| i18n | ✅ pre-existing | UI dictionaries en/te/hi/ta (`src/i18n.ts`); lyrics language independent |
| SEO & sharing | ✅ (Phase-earlier) | edge entity heads, live sitemap index, JSON-LD graph, OG cards |
| QA matrix | ✅ **written** | `qa-matrix.md` — platforms × 9 core flows |
| Observability | ✅ pre-existing | consent-gated vitals/errors, AI lane monitor |
| Staged rollout + rollback | ✅ **runbook written** | `rollout.md` — previews as canary, 3 rollback levers, delivery invariants |
| Lighthouse ≥ 95 targets | ◻ advisory | dedicated workflow runs per push; scores tracked, not asserted (flakiness policy) — revisit if regressions appear |

**Launch status:** the product ships continuously; with this phase the plan's five gates are
closed. Remaining owner actions: run the QA matrix on a real device pass, and submit the
sitemap in Search Console (one-time).
