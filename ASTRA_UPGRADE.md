# VinaX Astra 6.0 — changes and verification

## Customer experience

- New Astra visual system across the app shell, sidebar, mobile navigation, Home, media cards, player bar and now-playing rail.
- Orbital Aura Mix composition, discovery shortcuts and a redesigned AI workspace with a central composer and prompt cards.
- Waveform loading states, hover feedback and progressive scroll reveals where the browser supports CSS view timelines. Reduced-motion disables these effects. Light, AMOLED, custom accents and high-contrast settings remain available.
- **Refresh discovery** on Home rotates the daily mix and recommendation query seed, invalidates the ranking cache and remembers the previous hero picks. Favourites and listening history are retained.

## Recommendation changes

- One shared song-admission helper checks canonical song identity, IDs, language, muted languages, blocked songs, junk titles and very short tracks. Alternate releases such as remasters no longer bypass canonical exclusions.
- The fallback continuation searches up to three independent sources: the current song, another completed song and rotating language catalog pages. Artist sequencing happens after seed rotation so a shuffle cannot undo the artist-diversity pass.
- AI DJ discovery pages and taste artists rotate with the request seed.
- Final queue top-ups use the same exclusion rules. They no longer silently switch to another language when the catalog is exhausted.
- Served-song memory expires after seven days, is capped at 300 identities and has a session fallback when browser storage is unavailable. The last 60 history songs and the current queue stay excluded from continuations independently.
- AI playlists enforce recent-title and shared-identity exclusions, selected languages and blocklists. Catalog searches run four at a time and preserve model ordering. A short or empty result is preferable to padding with repeated or off-language songs.

A finite or unavailable catalog can still produce fewer songs or no continuation. Home may retain familiar songs when fresh inventory is insufficient; this release does not promise unlimited unique music.

## VinaX AI

- Astra theme, improved reading typography, prompt cards, composer focus, message surfaces and code/table presentation.
- Regenerate sends the correct conversation prefix and previous answer with an explicit request for a different approach, instead of reading stale state.
- Up to 32 previously recommended songs travel with each chat request and are accepted by the server's sanitized taste context.
- Reply instructions encourage an appropriate format for the task, avoid repetitive closings and request different artists/eras when the listener asks for more.
- Existing streaming, stop, copy, export, voice, code previews, charts and model selection remain available. This is a VinaX interface and orchestration upgrade; it does not train a new foundation model or make the configured providers equivalent to ChatGPT. Voice, web and model availability still depend on backend configuration.

## Owner console

- Astra surfaces, typography, table spacing and focus states across existing admin tools.
- A persistent Compact/Comfortable control in the desktop header.
- Animated loading placeholders with reduced-motion support.
- Overview shortcuts to AI monitoring and the skip report, alongside feedback, release and Home management tools.
- Existing authentication, endpoint contracts and publish controls remain in place.

## How to check after deployment

1. Open the site and confirm **Settings → About** displays **VinaX Astra 6.0**. If an old app shell is cached, close/reopen the tab and accept any update prompt. Avoid clearing site data because your library is local.
2. On **Home**, play the Aura Mix, then use **Refresh discovery**. Watch the loading state, inspect the new picks and confirm your saved library remains intact.
3. Play a song in a pinned language. Open **Queue**, skip forward and allow automatic continuation. Check that alternate releases do not repeat and blocked songs/languages stay out. Repeat with a different artist.
4. Open **/ai-playlist**. Generate the same broad prompt twice, such as “Telugu melodies across different artists and eras.” The second generation should avoid the first set; try another era if the catalog cannot supply fresh matches.
5. Open **/VinaXAI**. Ask for songs, then “Give me more, with different artists.” Use **More → Regenerate** on the last answer and confirm it answers the same question. Also try a code request and a comparison to inspect rich output, copy and stop controls.
6. Open **/admin/** and sign in. Check Overview, AI Monitoring, Skip Report, Home Screen Management and Operations Center. Toggle **Compact**, refresh the page and confirm it persists. Missing backend data should still show unavailable/empty states.
7. Check phone and desktop widths, light/dark/AMOLED, keyboard focus and the system's Reduce Motion setting. New motion should stop when Reduce Motion is enabled.
8. Inspect GitHub CI, Cloudflare Pages and the Deploy Worker workflow for the pushed commit. A successful Git push alone does not prove that the public site was deployed.

## Local checks

```sh
cd frontend
npm ci
npm run lint
npm run typecheck
npm test
npm run build
node scripts/check-bundle-size.mjs
npm run dev
```

```sh
cd backend
npm ci
npm run lint
npm run typecheck
npm test
WRANGLER_LOG_PATH=/tmp/vinax-wrangler.log npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/vinax-astra-worker-dry
```

For the separate browser regression suite, build first, install Chromium or set `E2E_CHROMIUM_PATH`, then run `npm run e2e` in `frontend`. Automated unit checks and builds do not establish live provider behavior, visual quality on every device or native Android playback. The existing Android workflow runs on main pushes and can publish an APK when signing secrets are configured; native playback has not been tested locally.
