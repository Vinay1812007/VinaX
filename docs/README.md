# VinaX documentation

This is the index of the current documentation. Everything here describes the product and the code as they are now (10.2: the Marigold redesign and Listen Together rewrite of 10.0, 10.1's frosted glass and new search, and 10.2's removal of web search). Dated records — release write-ups, audits, phase plans — are in [history/](history/README.md) and are not kept up to date. Start with the [project README](../README.md) if you have not run the app yet.

## For people working on the code

| Document | Read it when you need to know |
| --- | --- |
| [architecture.md](architecture.md) | What the pieces are and how data flows: app shell, routes and lazy chunks, stores and persistence, the catalogue client and 10.1's request allotment (latency ranking, hedging, Retry-After, spreading, de-duplication), the audio engine, the 10.0 Listen Together engine, the service worker, Worker routes, the owner console |
| [recommendations.md](recommendations.md) | How the next song is chosen: the ten-stage pipeline, the weights, session intent, event weights, Familiar / Balanced / Discover, the 7.2 playback and admission contracts, the queue rules (the next five, the 8.1 Queue languages setting, tunes and pinned moods, 8.2 AI Radio and Smart Queue), the 8.2 candidate sources and taste fit, 9.1's exposure ledger, snoozes, "fewer repeats" and the verified-trend source, Home shelves and Home's own order, the `?debug=recs` breakdown and its diagnostics summary |
| [ai.md](ai.md) | How AI is used and bounded: lanes, failover and the 8.2 cooldown table (the flagship lane's streaming), each AI route's contract including 8.2's `/api/embed`, the minimal assistant prompt, timeouts and budgets, VinaX AI's chat page (10.0 connectors and motion), the 10.2 removal of web search and what it took with it, what happens with every provider down |
| [ai-music.md](ai-music.md) | The 8.5 AI music experience end to end: why history stays on the device, where each part of the data model lives, the listening signals and taste profile, and the contract (schemas, auth, validation, errors, examples) of `/api/recommendations`, `/api/recommendations/similar/:songId`, `/api/ai/search`, `/api/ai/playlist` and `/api/ai/dj` |
| [trends.md](trends.md) | Verified trend ingestion: the provider adapters and what each provider's rules allow, scheduled jobs and quota, catalogue matching and confidence, momentum, the admin review queue and the honest labels the app shows |
| [ai-assistant-matrix.md](ai-assistant-matrix.md) | What VinaX AI actually does, feature by feature, with each gap named: what is done, partial, missing, provider-dependent or deliberately out of scope |
| [evaluation.md](evaluation.md) | The offline evaluation of next-song selection: fixtures (with the 8.1 mixed-language scenario), the mocks (8.2 adds embeddings and artist pages), metrics, the 7.1 comparison, and how to read an A/B result |
| [audit-9.1.md](audit-9.1.md) | The 9.1 review (dated): the confirmed causes of repeated recommendations, the live-discovery and location gaps as they were then (live discovery was removed in 10.2), the before/after measurements |
| [audit-7.2.md](audit-7.2.md) | The 7.2 review: every finding with its severity, evidence, reproduction, fix and validation |
| [progress-7.2.md](progress-7.2.md) | What 7.2 landed, what is deferred and why, and the decisions the owner owes |
| [design-system.md](design-system.md) | The 10.0 Marigold identity (tokens, display face, first visit, accents), the 10.1 frosted material scale, snackbars and inbox, the medium control scale, the hit-area rule, overlays and `data-vx-overlay`, motion rules, the top bar actions slot |
| [data-and-privacy.md](data-and-privacy.md) | What is stored where, the backup format, restore / merge / undo rules, what leaves the device and when |
| [testing.md](testing.md) | Unit tests, the browser suite and its harness (with the 10.0 Listen Together and 10.1 search specs), fixture shapes, checking the guided tours, the bundle budget and the `core` chunk group, verifying a commit in a throw-away worktree |
| [android.md](android.md) | How the Android project is generated and patched, the native media service, downloads (the 8.2 bitrate ladder, timeouts and failure reasons), the update flow, what needs a device |

## For people running the service

| Document | Read it when you need to |
| --- | --- |
| [../DEPLOYMENT.md](../DEPLOYMENT.md) | Deploy either half, or check a release |
| [operations.md](operations.md) | Set secrets, understand the scheduled jobs and monitoring, fix a stale Worker, read the known-red build check correctly, roll back, and the owner's clean-up after 10.2 retired web search |
| [admin-console.md](admin-console.md) | Use or change the owner console: sections, server-side auth, feature flags, Home layout publishing |
| [fcm-push-setup.md](fcm-push-setup.md) | Turn on Android background notifications |
| [qa-device-script.md](qa-device-script.md) | Check a build on real devices |
| [legal-copyright.md](legal-copyright.md) | Recall the legal position: content ownership, takedowns, listener data |

## For listeners

| Document | Covers |
| --- | --- |
| [user-guide/README.md](user-guide/README.md) | The guide's index |
| [user-guide/getting-started.md](user-guide/getting-started.md) | First run and the free welcome, the five destinations, playing a first song, the look (themes, accents, glass), snackbars and notifications |
| [user-guide/player-and-queue.md](user-guide/player-and-queue.md) | The player, Up Next, AI Radio, Smart Queue, Pin a mood, Tune this queue, queueing by hand |
| [user-guide/discovery-modes.md](user-guide/discovery-modes.md) | Familiar, Balanced and Discover |
| [user-guide/search.md](user-guide/search.md) | Finding music: suggestions as you type, the Top result, trending searches |
| [user-guide/library-and-backup.md](user-guide/library-and-backup.md) | Favourites, playlists, backup and restore |
| [user-guide/vinax-ai.md](user-guide/vinax-ai.md) | The AI chat (connectors, what it can and cannot know) and AI Playlist |
| [user-guide/listen-together.md](user-guide/listen-together.md) | Hosting and joining a Listen Together session, the Live pill, Tap to start listening |
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
