# Deploying VinaX

Both applications live on `main`: `frontend/` builds to Cloudflare Pages and `backend/` deploys the `vinax-api` Worker. Older instructions referring to separate frontend/backend branches are obsolete.

## Cloudflare Pages

Configure the `vinax` Pages project:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `22` or newer |

A push deploys automatically only when the Pages Git integration is enabled and healthy. Manual deployment from `frontend/`:

```sh
npm ci
npm run build
npx wrangler pages deploy dist --project-name vinax
```

## Worker

Keep bindings, routes and `ASSETS_HOST` aligned with `backend/worker/wrangler.toml`. Store credentials as Worker secrets; names are documented in `backend/.env.example`. For local development use the ignored `backend/worker/.dev.vars` file.

From `backend/`:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/vinax-worker-dry
npm run deploy
```

The **Deploy Worker** GitHub workflow provides a second deployment path when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are configured. Without credentials it skips deployment. If Cloudflare reports a deleted or rolled build token, repair that token in Cloudflare or configure the existing GitHub fallback; a source change alone cannot fix the token.

Pages serves static assets. Worker routes own API, image/APK proxy and configured SEO routes. Verify both deployments because successfully publishing one does not update the other.

## Release checks

1. Run the frontend and backend lint, typecheck and test commands in the root README.
2. Build the frontend, check its bundle budget and run the browser suite against `dist/`.
3. Confirm CI for the exact commit, then inspect Pages and Worker deployment results.
4. Check live `/api/health`, Home, search, playback, next-song, lyrics and `/admin/`. Test a new browser profile and a returning listener, desktop and mobile, light and dark themes.
5. Confirm the displayed app version and check the admin operational panels. Unavailable data does not count as a healthy signal.
6. For Android, verify native playback/downloads and release signing before creating a `v*` tag. Tagging triggers the signed APK workflow.

## Rollback

Use Pages deployment history to promote the previous successful deployment. Roll back the Worker through Cloudflare version history separately. Keep the two versions compatible; avoid reverting shared config blindly. Home layout changes can be reversed by restoring the previous configuration or publishing built-in defaults from the console. Export a config backup before larger operational edits.

A pushed commit, passing local checks and a live production verification are separate release milestones. Record which have actually completed.
