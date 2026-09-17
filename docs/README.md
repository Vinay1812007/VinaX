# VinaX documentation

This is the index of the current documentation. Everything here describes the product and the code as they are now (7.1). Dated records — release write-ups, audits, phase plans — are in [history/](history/README.md) and are not kept up to date. Start with the [project README](../README.md) if you have not run the app yet.

## For people working on the code

| Document | Read it when you need to know |
| --- | --- |
| [architecture.md](architecture.md) | What the pieces are and how data flows: app shell, routes and lazy chunks, stores and persistence, the catalogue client, the audio engine, the service worker, Worker routes, the owner console |
| [recommendations.md](recommendations.md) | How the next song is chosen: the ten-stage pipeline, the weights, session intent, event weights, Familiar / Balanced / Discover, the 7.1 queue rules, Home shelves, the `?debug=recs` breakdown |
| [ai.md](ai.md) | How AI is used and bounded: lanes and failover, each AI route's contract, timeouts and budgets, what happens with every provider down |
| [design-system.md](design-system.md) | The Flow tokens, the medium control scale, the hit-area rule, overlays and `data-vx-overlay`, motion rules, the top bar actions slot |
| [data-and-privacy.md](data-and-privacy.md) | What is stored where, the backup format, restore / merge / undo rules, what leaves the device and when |
| [testing.md](testing.md) | Unit tests, the browser suite and its harness, fixture shapes, the bundle budget and the `core` chunk group, verifying a commit in a throw-away worktree |
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
| [user-guide/getting-started.md](user-guide/getting-started.md) | First run, the five destinations, playing a first song |
| [user-guide/player-and-queue.md](user-guide/player-and-queue.md) | The player, Up Next, Pin a mood, Tune this queue, queueing by hand |
| [user-guide/discovery-modes.md](user-guide/discovery-modes.md) | Familiar, Balanced and Discover |
| [user-guide/search.md](user-guide/search.md) | Finding music |
| [user-guide/library-and-backup.md](user-guide/library-and-backup.md) | Favourites, playlists, backup and restore |
| [user-guide/vinax-ai.md](user-guide/vinax-ai.md) | The AI chat and AI Playlist |
| [user-guide/keyboard-shortcuts.md](user-guide/keyboard-shortcuts.md) | Every shortcut |
| [user-guide/android.md](user-guide/android.md) | The Android app |

## Package notes

[../frontend/README.md](../frontend/README.md) and [../backend/README.md](../backend/README.md) are short and point back here.

## Conventions for these documents

- Each file starts with one paragraph that says what it covers.
- Describe what the code does. If something cannot be checked, leave it out.
- Every command must exist in a `package.json`, in `frontend/scripts/` or in a workflow.
- No third-party product, company, music-service or AI-vendor names. Describe the behaviour instead. Host names and secret names a maintainer has to type appear only in [../DEPLOYMENT.md](../DEPLOYMENT.md), [operations.md](operations.md) and [fcm-push-setup.md](fcm-push-setup.md). Package names appear where a developer has to know them.
- When a document stops being true, fix it in the same change as the code. When it becomes a record of the past, move it to [history/](history/README.md) and add a line to the index there.
