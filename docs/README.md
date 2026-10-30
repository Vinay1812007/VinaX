# VinaX documentation

This is the index of the current documentation. Everything listed here describes the product and the code as they are now. Dated records — release write-ups, audits, phase plans — are in [history/](history/README.md) and are not kept up to date. Start with the [project README](../README.md) if you have not run the app yet.

## For people working on the code

| Document | Read it when you need to know |
| --- | --- |
| [architecture.md](architecture.md) | What the pieces are and how data flows: app shell, the look pipeline (app style, theme, accent, festival), routes and lazy chunks, stores and persistence, the catalogue client, the audio engine, Listen Together, the service worker, Worker routes, the database, the owner console |
| [database.md](database.md) | The database: setting it up, every table and function, the Worker's data layer (`_lib/db.ts` and its companions), the rules every route follows, the admin API contract, the public routes that read or write it, the scheduled jobs, what is stored and for how long |
| [app-styles.md](app-styles.md) | The six 15.0 app styles as a design contract: what each is modelled on, its face, colours, shapes, Home, tab bar, mini player and Now Playing, and the legacy id map |
| [design-system.md](design-system.md) | The token contract, the six app styles and their selector contract, themes, accents, festival skins, materials, the control scale and hit-area rule, overlays, focus, motion — and how to add an app style |
| [recommendations.md](recommendations.md) | How the next song is chosen: the pipeline and its weights, the listening signals and taste profile, session intent, discovery modes, the queue rules, candidate sources, the exposure ledger, Home shelves, the catalogue recommendation routes, the `?debug=recs` breakdown |
| [trends.md](trends.md) | Charts: `GET /api/trends` answers empty (the trend pipeline has no store in the 14.0 schema), how the app labels its lists, and what the pipeline used to be |
| [evaluation.md](evaluation.md) | The offline evaluation of next-song selection: fixtures, mocks, metrics, and how to read an A/B result |
| [data-and-privacy.md](data-and-privacy.md) | What is stored where, the backup format, restore / merge / undo rules, what leaves the device and when |
| [testing.md](testing.md) | The gates, unit tests, the contract tests (app styles, festivals, content-security hashes), the browser suite and its harness, fixture shapes, the bundle budget, verifying a commit in a throw-away worktree |
| [android.md](android.md) | How the Android project is generated and patched, the native media service, downloads, the update flow, what needs a device |

## For people running the service

| Document | Read it when you need to |
| --- | --- |
| [../DEPLOYMENT.md](../DEPLOYMENT.md) | Deploy either half, or check a release |
| [operations.md](operations.md) | Set secrets, move to a new database, understand the scheduled jobs and monitoring, fix a stale Worker, read the known-red build check correctly, roll back, keep or delete listener data |
| [admin-console.md](admin-console.md) | Use or change the owner console: every page and the routes it calls, server-side auth, the audit trail, the settings vocabulary and how a published setting reaches listeners, the fresh-database checklist |
| [fcm-push-setup.md](fcm-push-setup.md) | Turn on Android background notifications |
| [qa-device-script.md](qa-device-script.md) | Check a build on real devices |
| [legal-copyright.md](legal-copyright.md) | Recall the legal position: content ownership, takedowns, listener data |

## For listeners

| Document | Covers |
| --- | --- |
| [user-guide/README.md](user-guide/README.md) | The guide's index |
| [user-guide/getting-started.md](user-guide/getting-started.md) | First run and the welcome, the four destinations, playing a first song |
| [user-guide/app-styles.md](user-guide/app-styles.md) | The six app styles, themes and accents, and how to switch |
| [user-guide/friends-and-sharing.md](user-guide/friends-and-sharing.md) | Everything 15.0 added for listening with others and daily discovery |
| [user-guide/festival-themes.md](user-guide/festival-themes.md) | What happens on a festival, the greeting card, previewing a skin |
| [user-guide/player-and-queue.md](user-guide/player-and-queue.md) | The player, Up Next, Radio, Smart Queue, Pin a mood, Tune this queue, queueing by hand |
| [user-guide/flow.md](user-guide/flow.md) | Flow, the full-screen feed of song previews |
| [user-guide/discovery-modes.md](user-guide/discovery-modes.md) | Familiar, Balanced and Discover |
| [user-guide/search.md](user-guide/search.md) | Finding music: suggestions as you type, the Top result, trending searches |
| [user-guide/library-and-backup.md](user-guide/library-and-backup.md) | Favourites, playlists, backup and restore |
| [user-guide/listen-together.md](user-guide/listen-together.md) | Hosting and joining a Listen Together session |
| [user-guide/keyboard-shortcuts.md](user-guide/keyboard-shortcuts.md) | Every shortcut |
| [user-guide/android.md](user-guide/android.md) | The Android app |

## Package notes

[../frontend/README.md](../frontend/README.md) and [../backend/README.md](../backend/README.md) are short and point back here.

## History

[history/README.md](history/README.md) indexes the dated records, including the reviews that used to sit beside these documents: [history/audit-9.1.md](history/audit-9.1.md), [history/audit-7.2.md](history/audit-7.2.md) and [history/progress-7.2.md](history/progress-7.2.md).

## Conventions for these documents

- Each file starts with one paragraph that says what it covers.
- Write for a reader arriving today. Describe what the code does now; a version number appears only where a maintainer needs it to understand the code.
- If something cannot be checked, leave it out.
- Every command must exist in a `package.json`, in `frontend/scripts/` or in a workflow.
- No third-party product, company or music-service names. Describe the behaviour instead. The exceptions: host names and secret names a maintainer has to type appear only in [../DEPLOYMENT.md](../DEPLOYMENT.md), [operations.md](operations.md) and [fcm-push-setup.md](fcm-push-setup.md); package names appear where a developer has to know them.
- When a document stops being true, fix it in the same change as the code. When it becomes a record of the past, move it to [history/](history/README.md) and add a line to the index there.
