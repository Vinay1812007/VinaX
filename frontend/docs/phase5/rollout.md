# Staged Rollout & Rollback Runbook

## Pipeline (every push to main)
lint → typecheck → 61 tests → build + 28-route prerender → bundle budget (150 KB gz)
→ Lighthouse workflow (advisory scores) → Android APK build → Cloudflare Pages deploy.

## Canary procedure (for risky changes)
1. Push the change to a branch → Cloudflare Pages builds a **preview URL**.
2. Run the QA matrix's affected rows against the preview.
3. Merge to main (production). Pages deploys atomically.

## Rollback levers (fastest first)
1. **Instant rollback:** Cloudflare Pages → Deployments → previous good build → "Rollback".
2. **Git revert** the commit → CI redeploys (~3 min).
3. **Cache emergencies:** bump the asset URL epoch in `vite.config.ts`
   (`b2` → `b3`) — every asset URL changes, bypassing any poisoned cache; then
   zone **Purge Everything** if HTML itself was cached.

## Delivery invariants (do not regress)
- `/assets/*` must 404 when missing (never the SPA shell) — `public/_redirects`.
- Boot self-healing inline script must stay CSP-allowed (hash in `public/_headers`;
  recompute the hash if `index.html`'s inline script changes — CI typecheck won't catch it,
  the smoke row 1 of the QA matrix will).
- Service worker: navigations network-first; only hashed assets cache-first.

## Observability
- Admin dashboard: per-lane AI health pings, `@lane` routing tags, web-vitals p75,
  error feed (consent-gated, anonymous).
- Post-deploy smoke: load `/` headless — expect no `id="boot"` remnant, no
  "wrong note", zero CSP violations for first-party scripts.
