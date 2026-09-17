# VinaX frontend

This package is the VinaX app: a single-page web app that is also packaged for Android. This file covers how to run and verify it and where to make common changes. Everything else — architecture, recommendations, the design system, testing, Android, deployment — is in [../docs/](../docs/README.md).

## Develop

Use Node.js 22 or newer. From this directory:

```sh
npm ci
npm run dev
```

The app runs on port 5173. For anything dynamic, run `npm run dev` in `../backend` in a second terminal; the dev server proxies `/api`, `/img` and `/apk` to the Worker on port 8787. Keep credentials in the backend. A `VITE_*` variable is visible to every visitor.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run build
node scripts/check-bundle-size.mjs
npm run e2e
```

The browser suite serves `dist/`, so build first. It needs its test browser (`npx playwright-core install chromium`, or set `E2E_CHROMIUM_PATH` to an installed binary). See [../docs/testing.md](../docs/testing.md) for the harness, fixture shapes and the bundle budget.

## Where to change things

| To change | Edit |
| --- | --- |
| Design tokens and the Flow look | `src/styles/index.css`, `src/styles/flow.css` — see [../docs/design-system.md](../docs/design-system.md) |
| The shell (sidebar, top bar, dock, overlays) | `src/layouts/AppLayout.tsx`, `src/components/TopBar.tsx`, `src/components/BottomNav.tsx`, `src/components/Sidebar.tsx` |
| Routes | `src/router/index.tsx` |
| Home shelves | `src/pages/HomePage.tsx`, `src/features/home/` |
| What plays next | `src/services/recommendation/`, `src/store/playerStore.ts` — see [../docs/recommendations.md](../docs/recommendations.md) |
| The welcome sheet, tours and Help | `src/components/OnboardingSheet.tsx`, `src/features/tutorials/tutorials.ts`, `src/pages/HelpPage.tsx` |
| Backup and restore | `src/features/settings/backup.ts`, `src/features/settings/BackupCenter.tsx` |
| The owner console | `public/admin/` — see [../docs/admin-console.md](../docs/admin-console.md) |
| Android native code | `native-android/`, `scripts/patch-android.js` — see [../docs/android.md](../docs/android.md) |

## Releasing a version

Update these together: `package.json`, the root entry in `package-lock.json`, `src/constants/version.ts` and `src/constants/changelog.ts`. Deployment is described in [../DEPLOYMENT.md](../DEPLOYMENT.md). A web build alone does not validate Android media controls, downloads or signing.
