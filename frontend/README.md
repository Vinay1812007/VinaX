# VinaX frontend

This package is the VinaX app: a single-page web app that is also packaged for Android, plus the owner console under `public/admin/`. This file covers how to run and verify it and where to make common changes. Everything else is indexed in [../docs/README.md](../docs/README.md).

## Develop

Use Node.js 22 or newer. From this directory:

```sh
npm ci
npm run dev
```

The app runs on port 5173. For anything dynamic, run `npm run dev` in `../backend` in a second terminal; the dev server proxies `/api`, `/img` and `/apk` to the Worker on port 8787. Keep credentials in the backend.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run build
node scripts/check-bundle-size.mjs
npm run e2e
```

`npm run build` deletes `dist/` and the build caches before it starts. The browser suite serves `dist/`, so build first; it needs a test browser (`npx playwright-core install chromium`, or set `E2E_CHROMIUM_PATH`). See [../docs/testing.md](../docs/testing.md).

## Where to change things

| To change | Edit |
| --- | --- |
| Design tokens, the frame, page styles | `src/styles/index.css`, `src/styles/shell.css`, `src/styles/pages/*.css` — see [../docs/design-system.md](../docs/design-system.md) |
| An app style, or add one | `src/styles/templates/`, `src/constants/templates.ts`, `src/utils/theme.ts`, the pre-paint script in `index.html` — follow the checklist in the design system document |
| Festival themes | `src/constants/festivals.ts`, `festivalThemes.ts`, `festivalVisuals.ts`, `festivalEmblems.ts`, then `npm run gen:festivals` (it writes `src/styles/festivals.css`, `public/admin/festivals.js` and the table in `index.html`) |
| VinaX AI chat styles | `src/features/ai/chat/chatStyle.ts`, `src/styles/ai-styles.css` |
| The shell (sidebar, top bar, dock, overlays) | `src/layouts/AppLayout.tsx`, `src/components/TopBar.tsx`, `src/components/BottomNav.tsx`, `src/components/Sidebar.tsx` |
| Routes | `src/router/index.tsx` |
| What plays next | `src/services/recommendation/`, `src/store/playerStore.ts` — see [../docs/recommendations.md](../docs/recommendations.md) |
| The welcome sheet, tours and Help | `src/components/OnboardingSheet.tsx`, `src/features/tutorials/tutorials.ts`, `src/components/TutorialRunner.tsx`, `src/pages/HelpPage.tsx` |
| Backup and restore | `src/features/settings/backup.ts`, `src/features/settings/BackupCenter.tsx` |
| The owner console | `public/admin/` — see [../docs/admin-console.md](../docs/admin-console.md) |
| Android native code | `native-android/`, `scripts/patch-android.js` — see [../docs/android.md](../docs/android.md) |

## Releasing a version

Update these together: `package.json`, the root entry in `package-lock.json`, `src/constants/version.ts` and the What's New card in `src/constants/changelog.ts`. If you changed an inline script in `index.html`, build and run `node scripts/csp-hashes.mjs`. Deployment is described in [../DEPLOYMENT.md](../DEPLOYMENT.md).
