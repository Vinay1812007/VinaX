# VinaX documentation

This is the index of the current documentation. Everything listed here describes the product and the code as they are now. Dated records — release write-ups, audits, phase plans — are in [history/](history/README.md) and are not kept up to date. Start with the [project README](../README.md) if you have not run the app yet.

## For people working on the code

| Document | Read it when you need to know |
| --- | --- |
| [architecture.md](architecture.md) | What the pieces are and how data flows: app shell, the look pipeline (app style, theme, accent, festival, chat styles), routes and lazy chunks, stores and persistence, the catalogue client, the audio engine, Listen Together, the service worker, Worker routes, the owner console |
| [design-system.md](design-system.md) | The token contract, the six app styles and their selector contract, themes, accents, festival skins, the VinaX AI chat styles, materials, the control scale and hit-area rule, overlays, focus, motion — and how to add an app style |
| [recommendations.md](recommendations.md) | How the next song is chosen: the pipeline and its weights, session intent, discovery modes, the queue rules, candidate sources, the exposure ledger, Home shelves, the `?debug=recs` breakdown |
| [ai.md](ai.md) | How AI is used and bounded: lanes, failover and cooldowns, each AI route's contract, timeouts and budgets, the VinaX AI chat page, what happens with every provider down |
| [ai-music.md](ai-music.md) | The AI music experience end to end: why history stays on the device, the listening signals and taste profile, and the contracts of the recommendation and `/api/ai/*` routes |
| [ai-assistant-matrix.md](ai-assistant-matrix.md) | What VinaX AI does, feature by feature, with each gap named |
| [trends.md](trends.md) | Verified trend ingestion: provider adapters, scheduled jobs and quota, catalogue matching, momentum, the review queue |
| [evaluation.md](evaluation.md) | The offline evaluation of next-song selection: fixtures, mocks, metrics, and how to read an A/B result |
| [data-and-privacy.md](data-and-privacy.md) | What is stored where, the backup format, restore / merge / undo rules, what leaves the device and when |
| [testing.md](testing.md) | The gates, unit tests, the contract tests (app styles, chat styles, festivals, content-security hashes), the browser suite and its harness, fixture shapes, the bundle budget, verifying a commit in a throw-away worktree |
| [android.md](android.md) | How the Android project is generated and patched, the native media service, downloads, the update flow, what needs a device |

## For people running the service

| Document | Read it when you need to |
| --- | --- |
| [../DEPLOYMENT.md](../DEPLOYMENT.md) | Deploy either half, or check a release |
| [operations.md](operations.md) | Set secrets, understand the scheduled jobs and monitoring, fix a stale Worker, read the known-red build check correctly, roll back |
| [admin-console.md](admin-console.md) | Use or change the owner console: sections, server-side auth, feature flags, Home layout publishing |
| [fcm-push-setup.md](fcm-push-setup.md) | Turn on Android background notifications |
| [qa-device-script.md](qa-device-script.md) | Check a build on real devices |
| [legal-copyright.md](legal-copyright.md) | Recall the legal position: content ownership, takedowns, listener data |

## For listeners

| Document | Covers |
| --- | --- |
| [user-guide/README.md](user-guide/README.md) | The guide's index |
| [user-guide/getting-started.md](user-guide/getting-started.md) | First run and the welcome, the five destinations, playing a first song |
| [user-guide/app-styles.md](user-guide/app-styles.md) | The six app styles, themes and accents, and how to switch |
| [user-guide/festival-themes.md](user-guide/festival-themes.md) | What happens on a festival, the greeting card, previewing a skin |
| [user-guide/player-and-queue.md](user-guide/player-and-queue.md) | The player, Up Next, AI Radio, Smart Queue, Pin a mood, Tune this queue, queueing by hand |
| [user-guide/flow.md](user-guide/flow.md) | Flow, the full-screen feed of song previews |
| [user-guide/discovery-modes.md](user-guide/discovery-modes.md) | Familiar, Balanced and Discover |
| [user-guide/search.md](user-guide/search.md) | Finding music: suggestions as you type, the Top result, trending searches |
| [user-guide/library-and-backup.md](user-guide/library-and-backup.md) | Favourites, playlists, backup and restore |
| [user-guide/vinax-ai.md](user-guide/vinax-ai.md) | The AI chat, its models and chat styles, and AI Playlist |
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
- No third-party product, company, music-service or AI-vendor names. Describe the behaviour instead. The exceptions: the AI documents ([ai.md](ai.md), [ai-music.md](ai-music.md), [ai-assistant-matrix.md](ai-assistant-matrix.md), [user-guide/vinax-ai.md](user-guide/vinax-ai.md)) may name the configured AI providers and real model and maker names; host names and secret names a maintainer has to type appear only in [../DEPLOYMENT.md](../DEPLOYMENT.md), [operations.md](operations.md) and [fcm-push-setup.md](fcm-push-setup.md); package names appear where a developer has to know them.
- When a document stops being true, fix it in the same change as the code. When it becomes a record of the past, move it to [history/](history/README.md) and add a line to the index there.
