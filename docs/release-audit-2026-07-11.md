# Production release audit — 2026-07-11 (v1.2.0)

End-to-end pre-release pass over the whole repository. Grouped by category;
every item lists what changed, where, and why.

## Security
- **No hardcoded secrets** anywhere in tracked files (scanned for NVIDIA/Groq/
  OpenRouter/Google key shapes and JWTs — only a docstring mentions a prefix).
  All secrets live in Cloudflare Pages env vars; names documented in `.env.example`.
- **`.env.example` rewritten** — it referenced retired variables (`GROQ_API_KEY`,
  `ADMIN_TOKEN`) and missed real ones. Now documents the exact names the code
  reads: NVIDIA lanes, Supabase, `ADMIN_LOGIN_PASSWORD`, `VAPID_*`, `CRON_SECRET`,
  Brave/GitHub options.
- **`.gitignore` hardened** — now also covers `.dev.vars*` and `.wrangler/`
  (wrangler's local secret store) alongside `.env*`, `node_modules`, `dist`.
- **Endpoint authentication verified** — every file in `functions/api/admin/*`
  checks `isAdmin`; cron endpoints require `CRON_SECRET`; push subscribe/
  unsubscribe store only their own endpoint row.
- **Injection review** — all PostgREST filter interpolations use
  `encodeURIComponent` or validated numbers; admin dashboard HTML escapes
  `&<>"` everywhere it renders third-party strings.
- **APK signing** — release APKs are signed from the `ANDROID_KEYSTORE_BASE64`
  GitHub secret. The committed `ci/debug-keystore.b64` only signs DEBUG builds
  (kept deliberately for a stable debug signature).

## Bugs & logic
- **Admin delete-user audit ordering** (`functions/api/admin/maintenance.ts`):
  the audit note was written before the deletion — a failed delete would still
  log "Deleted user…". The note is now written only after both deletes succeed.

## Code quality
- No `console.log` in shipped code (only build scripts print). Dead voice-mode
  code and CSS were fully removed in 1.1.26–1.1.27; ESLint runs with
  `--max-warnings 0` in CI.

## Dependencies
- `npm audit`: **0 vulnerabilities** (prod and dev). Lockfile committed.
- Outdated majors deliberately NOT upgraded (breaking): Capacitor 6→8,
  React 18→19 types, ESLint 9→10. See "Deferred decisions".

## Config & environment
- No `localhost` in production paths (remaining references are dev-origin
  guards and docs). Debug logging is gated behind `import.meta.env.DEV`.
- Dev = `npm run dev` with zero secrets; production = Cloudflare Pages with
  encrypted env vars. The Android app is a live-site shell (`capacitor.config.ts`).

## Verification
- New `src/constants/release.test.ts`: version ↔ package.json ↔ changelog
  lock-step + storage-key uniqueness (3 tests; suite now 64).
- Full gates: eslint 0 warnings · tsc clean · vitest 64 · build + 28 prerendered
  routes · first-load budget ≤150 KB gz · esbuild on all touched functions.

## Documentation
- README truth pass: version/tests/bundle badges, correct AI-lane mapping
  (`_GEM` = conversational agent, `_MTA` = home builder), retired voice mode
  replaced by the chat mini-player, notifications feature, real secret names,
  pointer to `.env.example`.

## Deferred decisions (deliberately unchanged — owner's call)
1. **Capacitor 6 → 8** — native toolchain upgrade; requires APK rebuild+retest.
2. **React 19 / ESLint 10 majors** — churn without a driver; revisit quarterly.
3. **Version ranges** — package.json keeps `^` ranges; the committed lockfile
   pins actual versions. Switching to exact pins is policy, not safety.
4. **Debug keystore in repo** — intentional (stable debug signatures). Rotating
   it breaks nothing for users; rotating the RELEASE keystore would break
   updates for existing installs — never do that casually.
5. **Database schema** — untouched. No migrations needed by this audit.
6. **Public API contracts** — untouched (`/api/*` shapes unchanged).
