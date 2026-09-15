# VinaX frontend

React 19, TypeScript and Vite power the listening app. Capacitor packages the same application for Android. The standalone admin console lives in `public/admin/`.

Start with the [project README](../README.md) for features, personalization, privacy and repository structure, or the [deployment guide](../DEPLOYMENT.md) for Cloudflare settings.

## Develop

Use Node.js 22 or newer. From this directory:

```sh
npm ci
npm run dev
```

Run `npm run dev` from `../backend` in a second terminal for dynamic endpoints. Vite proxies the API to the Worker on port 8787; the frontend runs on port 5173. Keep credentials in the backend, never in browser-visible `VITE_*` variables.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run build
node scripts/check-bundle-size.mjs
npm run e2e
```

The browser suite serves `dist/` and mocks backend responses. Install Chromium with `npx playwright-core install chromium` if needed, or set `E2E_CHROMIUM_PATH`. Browser tests cover Home and playlist layouts, mobile width, personalized playlist starters and owner console navigation. Screenshots go into ignored `test-results/`.

## Editing the experience

- Shared themes and materials: `src/styles/index.css`.
- Listening and playlist Studio layouts: `src/styles/studio.css`.
- Home catalog shelves: `src/pages/HomePage.tsx`.
- Album, playlist and manual queue playback: `src/store/playerStore.ts`.
- Welcome and guided tours: `src/components/OnboardingSheet.tsx`, `src/features/tutorials/tutorials.ts`.
- Admin UI: `public/admin/app.js`, `public/admin/index.html`, `public/admin/studio.css`.

AI DJ, automatic next-song recommendations, AI Home shelves and listener layout editing are removed. Settings version 3 drops retired queue and layout preferences while preserving other settings.

When changing a release, update `package.json`, the root package entry in `package-lock.json`, `src/constants/version.ts` and `src/constants/changelog.ts` together.

For native development, see [native-android/README.md](native-android/README.md). A web build alone does not validate Android media controls, downloads or signing.
