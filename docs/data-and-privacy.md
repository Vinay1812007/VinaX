# Data and privacy

This document says what VinaX keeps on a listener's device, what leaves the device (when, to what kind of service, and under which setting), what the usage-sharing choice controls, and how backup, restore, device transfer and erasing behave. It is written from the code: the storage registry (`frontend/src/constants/storage-keys.ts`), the backup module (`frontend/src/features/settings/backup.ts`), the network clients under `frontend/src/services/` and `frontend/src/features/`, and the Worker routes under `backend/worker/functions/api/`. The listener-facing version is [user-guide/library-and-backup.md](user-guide/library-and-backup.md); the in-app text is `frontend/src/pages/PrivacyPage.tsx`.

## The short version

- **Device first, account second.** Library, history, settings and the taste profile live on the device. A signed-in listener's library, history, taste and settings also sync to their account as one copy. Clearing site or app data removes the device copy; the app offers an export.
- **The personal engine, on while signed in, off with one switch.** Since V2 1.4 a signed-in listener's plays, completes, skips, likes and saves are also reported to a taste model kept with the account on the server, which builds Home, playlists and radio ([personalisation.md](personalisation.md)). Settings → Region & privacy has the switch and **Erase my taste model**; Kid mode never reports. The section [The personal engine](#the-personal-engine) lists every field.
- **Features that need the network send what they need.** Browsing sends search words and ids to the catalogue source. Signed out, or with the personal engine off, the listening history and the taste profile stay on the device; the heard-set never leaves it. The music AI features send only the compact summaries listed under [AI](#ai), and what a signed-in listener types into VinaX AI goes to its providers. Listen Together, usernames, feedback, notifications and device transfer each send the fields listed below.
- **Usage statistics are on by default, off with one switch.** Since 14.0.3 the box on the welcome sheet is ticked and says so; Settings → Region & privacy has the switch. While it is off, no usage events are sent. Devices that onboarded earlier, with the old unticked box, were switched to the default once and told, with the switch one tap away. **Session insights (third-party, masked replays) are opt-in**, their own switch in Settings, off by default.
- **There is no advertising.** No page loads an advertising script, on the web or in the Android app. See [Advertising](#advertising).
- **The server keeps what its features need, in one database, and nothing more.** The tables are listed under [Server-side records](#server-side-records): no IP addresses, no precise location. Usage events are kept for a bounded time and then purged. Rate limiting keys on a hashed network address, not the address itself.

## Your Google account

VinaX needs a Google account: until a listener signs in, every page is the sign-in screen (the Privacy, Terms and Contact pages stay readable). Signing in sends Google's ID token to the Worker, which checks it with Google and stores one row in `accounts`: the Google account ID, email address (and whether Google verified it), name, profile picture address, the linked device (`listener_id`) when the device proves its signed ID, and the time. The device is linked at sign-in or on the app's session check once per load; that check also refreshes the time at most every 10 minutes. The row also holds coarse sign-in facts, written at sign-in and on that same refresh: the edge's geo for the request (`country`, `region`, `city`; the IP address is never stored), `platform` (web, android, ios) and `app_version`. The owner console's Listeners page shows every account with its name, email, profile photo and these facts, whether or not the listener shares usage; plays, searches and favourites reach the server only while usage sharing is on (the default). The Privacy page says so.

**Account emails.** With `RESEND_API_KEY` set on the Worker, VinaX sends account emails through Resend (`_lib/email.ts`): a welcome on an account's first sign-in, and a sign-in alert on every later sign-in, which says so when the device was not yet linked to the account. Both list the time, the browser and system (read from the user agent), the connection's IP address (`cf-connecting-ip`) and the edge's city/region/country. The IP address is written into the email only, never into the database. Resend receives the email address, the first name and the email's text. Console admins also get an email for each console sign-in (every owner for a recovery-password sign-in) and when they are invited. Nothing is stored about sent emails beyond the change log entry for a console test send; the owner switches each kind off with the `email` setting. There are no marketing emails.

**What syncs.** The account also holds one copy of the listener's data in `account_backups`, in the same format as the backup file: settings, library and playlists, smart collections, listening history, taste profile, bookmarks and the Home layout. The lifetime heard-set is not part of it. It is merged into each device the listener signs in on and updated a few seconds after a change; a version number makes two devices merge instead of overwrite each other. **Searches and this device's identity never sync.** The copy is at most 2 MB.

**Session and deletion.** The session is kept on the device and sent only to the Worker's account routes: `/api/auth/*`, `/api/account/*`, `/api/personal/*`, `/api/ai/*`, `/api/profile`, `/api/follow` and `/api/shared-playlist`. **Sign out** forgets it on the device (the data stays on the device and in the account). **Delete account** (Settings → Profile, also reached from the top-bar avatar menu) removes the account row and, with it, the synced copy from the server. On the website the sign-in button and its script load from Google; in the Android app the system's Google account sheet is used.

## What is stored on the device

| Where | What | Notes |
| --- | --- | --- |
| `localStorage`, registry keys (`vinax.*`) | Settings (`vinax.settings.v1`, which includes the app style as `template`), player state and queue, library, history (last 150 plays), search state, taste profile and the separate Kid-mode profile, region, welcome-done flag, last-seen version, name, username and pending username, alarm, lyric offsets, karaoke history, weekly mix, output choice, downloads index, room host keys, update reminders, the install id (`vinax.device-id`), the signed id issued by the service (`vinax.signed-device-id`), the usage-sharing choice (`vinax.analytics-consent`) | `constants/storage-keys.ts` is the registry. |
| `localStorage`, feature keys (`vinax.*`) | Bookmarks, smart collections, search workspace, streak, sidebar groups, Home layout and the AI Home choices (`vinax.home.ai.v1`), the songs made with song generation lately (`vinax.generated.v1`, at most 30, for Home), Home signals (`vinax.home.signals.v1`), recommendation memories (`vinax.recs.outcomes.v1`, `vinax.recs.seedmemo.v1`, `vinax.recs.exposure.v1`, `vinax.recs.snoozed.v1`), dismissed banners | Each feature owns its key next to the registry. |
| `sessionStorage` | Boot and chunk-reload counters, the restore Undo snapshot (`vinax.backup.undo.v1`), this session's Home order, session intent, and the live Listen Together session (`vinax.together.session.v1`: mode and room code, so a reload rejoins) | Gone when the tab closes. |
| IndexedDB `tarang-db` | The listen-event log behind taste insights | `services/storage/idb.ts`. |
| IndexedDB `vinax-heard` | The lifetime heard-set: the canonical key (normalised title and lead artist) of every song that counted as a play, with the time it was first heard. Never repeat reads it | `services/recommendation/heardSet.ts`. No cap and no expiry. It never leaves the device except inside a backup file the listener exports. |
| Cache storage `vinax-shell-*` | App shell and build assets | Managed by the service worker. |
| Cache storage `vinax-audio-v1` | Downloaded songs | Not cleared by a service-worker update or by boot recovery. |
| Android app storage | Downloaded audio files | Android only; paths are in the downloads index. |

Every persisted store writes through the guarded layer described in [architecture.md](architecture.md#stores-and-persistence): a full device shows one warning instead of breaking playback, and writes are frozen between a restore and its reload.

The app style is a display preference only. No request builder and no usage event reads it, so it is not sent anywhere.

## What leaves the device

"The Worker" below is VinaX's own backend. Fields are listed as the clients build them.

### Always-on functional requests

| When | Goes to | What is sent |
| --- | --- | --- |
| Browsing, searching, opening a song, album, artist, playlist, chart or video page | The catalogue source, directly or through the Worker's catalogue routes | Search words, ids, language and page parameters |
| Playing a song | The audio host named in the song's stream URL | A normal media request |
| Showing artwork | The artwork host; the Worker's image route only when a share card needs a same-origin copy | Image URLs. The content-security policy (`frontend/public/_headers`) allows images from any `https:` host plus `data:` and `blob:`; it names no specific image host, so there is no unused host to remove, and `frontend/index.html` sets no `img-src` of its own |
| Opening lyrics | An open lyrics database, then the catalogue source as fallback | Track title, artist and duration |
| Searching by lyric words (Search page) | The same open lyrics database (`services/lyrics/lrclib.ts`) | The words typed |
| App config, flags, festival window, announcements, blocklist, site mode, version and update check, experiment list, trending searches | The Worker | Nothing personal |
| Trends shelves (`/api/trends`) | The Worker | A two-letter region code, a language and a limit, when set |
| Region guess (`/api/geo`) | The Worker | Nothing beyond the request itself. The answer is a country code, a region name, the edge's approximate city and a time zone. Asked only while region inference is allowed (`allowRegionInference` in settings) and no manual override is set, and at most once every 12 hours unless the listener refreshes it. The answer is cached on the device under the region key. |
| Choosing a username (`/api/username`) | The Worker, which keeps the handle on the device's `listeners` row | The username, display name, install id, the signed id when one exists, and the current username when changing it. Checking availability sends only the candidate username. |
| Sending feedback (`/api/feedback`) | The Worker, which stores it in `feedback` | Message and its type, platform, app version, the display name when one is set, and the install id when one exists. The Worker adds country and city from the edge. |
| Turning notifications on (`/api/push/*`) | The Worker, which stores it in `push_devices` | Web: the browser's push endpoint and keys, the app language and the time-zone offset. Android: the push token, the platform, the app language and the time-zone offset. For both, the Worker adds the country, region and approximate city the edge reports for the request. Turning them off sends the endpoint, and the Worker marks that device inactive. |
| Listen Together (`/api/room`) | The Worker, which stores the room in `rooms` and `room_members` | Room code, display name, the playing song, upcoming songs and the playback position. Hosts push on every change and as a keep-alive; guests poll, send a heartbeat with the install id, and send a leave beacon when the tab closes. A song request carries the song's id, title, artwork and the guest's name; a reaction carries one emoji from a fixed list. Only the host's key unlocks member names; guests see a count. Ending the room deletes the room and its member rows; leaving deletes that member's row; a room idle for six hours is deleted by the hourly housekeeping job. |
| Move to a new device (`/api/handoff`) | The Worker's short-lived relay | Ciphertext only. Kept at most ten minutes and deleted on first read. |
| Casting to another device | A cast framework script, loaded from its vendor only when the device picker is opened (web only) | A normal script request |

The install id is a random value created on the device the first time something needs it: claiming a username, joining or hosting a room, or sending a usage event.

### The personal engine

Only while signed in, with the setting on, and not in Kid mode (`services/personal/api.ts` `personalEnabled`). Switching the engine off stops the reporter at once and clears its queue; the on-device engine takes over.

| When | Goes to | What is sent |
| --- | --- | --- |
| A play is counted, a song is completed or skipped, liked or un-liked, marked not interested, saved to a playlist, queued, or played from search (`services/personal/reporter.ts`, from `services/personalization/tasteEvents.ts`) | The Worker, `POST /api/personal/events`, in batches every 15 s, at 25 events, when the page hides and when the connection returns | Per event: a device-minted event id, the kind, the time, the song id, seconds heard and the song's length, which surface it came from (a Home shelf's key and the position on it, radio, search, the playlist maker), and the local hour, weekday and time-zone name. Per song in the batch, once: id, title, artists (with catalogue ids), album, language, year, length, artwork link and the facets the device inferred (mood, genre, vibe, energy, tempo). The batch also carries the Familiar / Balanced / Discover setting. The account's plays also count, anonymously, in two community figures every listener's Home draws on (how many listeners played a song this week; which songs are played together). |
| Home opens, or Refresh Home (`features/home/personal/usePersonalHome.ts`) | The Worker, `GET /api/personal/home` | The local hour and weekday, the discovery mode, the active festival's id |
| Make me a playlist (`features/home/personal/PlaylistMaker.tsx`) | The Worker, `POST /api/personal/playlist` | The request text (3–500 characters), the number of songs wanted, the local hour |
| Up Next refills while the engine is on (`services/nextup/engine.ts`) | The Worker, `GET /api/personal/recommend` | The newest anchor song's id, the discovery mode, the local hour |
| Erase my taste model | The Worker, `DELETE /api/personal/taste` | Nothing but the session |

On the server, an event batch is folded into the account's taste model (`personal_taste`: artists, languages, moods, decades and hours as decaying scores, the songs with their scores, a short summary, and a 1024-dimension vector), the songs join the shared song pool (`personal_songs`, no account attached), and what the account was shown or played is kept in `personal_exposure`. Two steps use an AI model: each song's catalogue words (title, artists, album, language, year, facets) are embedded once, which says nothing about any listener; and the Home page and a requested playlist are arranged by one of the models VinaX AI uses, which is given the taste summary's few lines, the hour, the day, the first name and the candidate songs — never the event history. The providers are the ones [ai.md](ai.md) lists. Events are kept for a year; a composed Home page for 30 minutes, a playlist for 30 days. Deleting the account removes all of it; **Erase my taste model** removes all of it and keeps the account.

### AI

Signed out, or with the personal engine off, nothing about listening is sent to an AI service: what plays next, Radio, Home's shelves and the taste profile are worked out on the device ([recommendations.md](recommendations.md)). With the engine on, the section above says exactly what reaches a model. Voice search and Drive mode's voice commands use the browser's or the phone's own speech recognition, and the commands are read by simple rules on the device; VinaX never receives or stores audio, only the words that end up in a search.

**Music AI.** These features send a summary the device builds (`frontend/src/services/ai/tasteSummary.ts`), through the Worker, to the same AI providers as VinaX AI ([ai.md](ai.md#music-ai)). Nothing is stored, and the Worker logs only counts and the model. Each has a switch, and the app plays its own picks when it is off or the AI is away. Since November 2026 the AI DJ and AI Playlist also send the titles and lead artists of the listener's last 10 songs, and the AI may suggest songs by title and artist; the device looks each one up in VinaX's own catalogue and keeps only real, playable matches (`frontend/src/services/ai/suggest.ts`).

| Feature (switch) | Sent to `POST /api/ai/…` | Fields, exactly |
| --- | --- | --- |
| Let AI build my Home (Settings → Home, on by default) | `home-layout`, once per Home generation (at most every 30 minutes, or on a refresh) | The Home generation number; the same taste summary and sitting intent; the shelf types Home may show and those the listener marked "Not interested"; up to 8 of the listener's own songs as seeds, each as `{ key, language, mood, genre, leadArtist }` under a made-up key (`s0`…), never a title or catalogue id; up to 20 shelf titles the AI gave Home lately (`recentTitles`, kept on the device in `vinax.home-ai.titles.v1`) so it does not repeat them |
| AI DJ (Settings → Recommendations, on by default) | `dj`, at most once per playing song and "Tune this queue" chip every 10 minutes | The playing song `{ title, artist, language, mood, energy }`; the titles and lead artists of the last 10 songs the listener let play (`recent`); the taste summary and this sitting's intent, as for `rerank` (the intent carries the tune chip). The answer is up to 15 songs as `{ title, artist, reason }`, which the device searches for in the catalogue |
| AI Playlist (Library and Queue → AI Playlist, when the listener presses Make playlist) | `playlist`, once per request | What the listener typed (at most 200 characters), how many songs (10–30), the titles and lead artists of the last 10 songs they let play, and the taste summary. The answer is a title and songs as `{ title, artist, reason }`; the device resolves them in the catalogue and drops muted languages and songs played in the last 7 days. With the AI away, the list comes from a catalogue search for the same words |
| Lyrics tools (Lyrics page → Romanized, English, Meaning) | `lyrics`, when the listener picks English or Meaning, or Romanized for lyrics the catalogue has no English-letters copy of | The song's lyric lines as shown (at most 160), its title, lead artist and language, and the task (`romanize`, `translate` or `explain`). Nothing about the listener |
| Generate a song like this (Now Playing; "Add a generated song to my queues" in Settings → Recommendations, off by default) | `generate-song`, when the listener presses Generate, or once per stretch with the switch on | The playing song's feel only: `{ mood, energy, tempo, genre, language, durationSec, instrumental, kid }` and the listener's own optional words (`promptText`, at most 200 characters; none in Kid mode). Never the song's audio, title, artist or lyrics. The header `x-vinax-device` carries the install id for the daily quota; the Worker stores only a hash of it with the day. The Worker turns the feel into a text brief and sends that alone to Google (Gemini's music models); a background job is kept by Google for its standard retention period, and a song made in one call is sent with `store: false` |
| AI fine-tunes Up Next (Settings → Recommendations, on by default) | `rerank`, once per continuation | Up to 40 songs as `{ key, language, mood, energy, genre, leadArtist }`, where `key` is a label made up for the request (`c0`…), never a title or catalogue id; the taste summary `{ languages (≤ 4), artists (≤ 8 lead-artist names), moods (≤ 4), energyByHour (4 numbers: night, morning, afternoon, evening), discovery, skipStreak, hour, weekday }`; this sitting's intent `{ mood, tune, language, energySteer, completionStreak }` | Voice search and Drive mode's voice commands use the browser's or the phone's own speech recognition, and the commands are read by simple rules on the device; VinaX never receives or stores audio, only the words that end up in a search.

VinaX AI ([ai.md](ai.md)), the chat at `/vinaxai`, is the one place AI is used, and only when a signed-in listener uses it:
- What they type goes from the Worker to one of the AI providers to generate the reply. The privacy page names them.
- The chat never sees the listening history or anything outside the conversation, apart from the listener's memory notes while memory is on ([VinaX AI memory](#vinax-ai-memory)).
- Settings → Personalisation (what to call them, what to know about them, how to reply, a reply style) is kept on the device (`vinax.vxai.prefs.v1`) and sent with each message, so the answering provider sees it with the conversation. The Worker uses it for that reply only: it is not stored with the chat and not logged.
- When a reply searches the web, the search words (the latest message, with links cut to their site names) go either to Google, through Gemini's Search grounding, or to the search provider (Tavily or Serper). A search's results are cached at the edge for up to an hour, keyed by a hash of the query.
- Conversations are stored with the account (`ai_conversations`, `ai_messages`; [database.md](database.md)), so they follow it to every device.
- A deleted chat is hidden at once and removed within a day. Deleting the account removes every chat.
- Files added to a chat stay with the account, in a private Storage bucket that only the Worker can read. Images are shrunk on the device first; a PDF's text is read on the device. They are sent to the AI provider that answers, and removed with their chat or the account. Files added but never sent are removed after a day.
- The Worker logs only the route, model, provider, latency, status and token counts, never message text.
- Voice is used only when the listener presses a voice button:
  - **Dictation** sends the recorded clip from the Worker to Groq (Whisper), or to Google (Gemini) when Groq cannot take it, and returns the text to the composer. Neither the clip nor the text is stored until the listener sends the message.
  - **Read aloud** sends the reply's words to Groq (Orpheus) or Google (Gemini) and plays the audio. Nothing is stored.
  - **Live voice** streams the microphone from the device straight to Google (Gemini Live), with a one-use token the Worker makes. The key stays in the Worker. What both sides say is saved in the chat as ordinary messages when Live voice closes, with the links a reply searched. The audio itself is not stored. With "Search the web in Live voice" on (Settings → Voice, or the globe button in Live voice; offered only when the owner's search switch is on), Google's Live model may turn what the listener says into Google searches to answer; that happens inside Google's session, and the Worker never sees the searches. When the listener switches search during a session, the page reconnects and sends the Worker the latest turns of the call (at most 4,000 characters) to put in the new session's instructions; they are not stored or logged.
  - Music pauses while the mic is open.
- The page keeps nothing about the chat on the device.
- **Shared links** exist only when the listener makes one ([Shared chats](#shared-vinax-ai-chats)).
- **Projects** exist only when the listener makes one ([VinaX AI projects](#vinax-ai-projects)).

### VinaX AI memory

VinaX AI keeps a short list of notes about the listener across chats, such as "Is learning Carnatic vocals" or "Prefers answers in Telugu", so they don't have to repeat themselves. It is on by default and the listener controls it in VinaX AI's settings → **Memory**.
- **What is stored.** At most 50 notes of at most 200 characters each (`ai_memories`; [database.md](database.md)): the text, whether VinaX AI learned it from a chat or the listener added it, the chat a learned note came from (until that chat is deleted), and when. Also the listener's two switches, Use memory and Learn from my chats (`ai_memory_prefs`), and whether a chat is incognito (`ai_conversations.incognito`).
- **How notes are learned.** With both switches on, after every third message of a chat, and whenever a message asks VinaX AI to remember or forget something, the Worker sends a small AI model (one of the AI providers the privacy page names) the current notes and the latest messages of that chat: at most the listener's last three messages (each cut at 2,000 characters) and the replies between them (each cut at 1,500 characters, with code and artifacts left out). Nothing else: not the listener's name, settings, files or other chats. The model answers with notes to add or remove. It is told never to keep passwords, codes or keys; card, bank, account or ID numbers; email addresses, phone numbers or addresses; health details; sex life, religion, politics, caste or ethnicity; or anything about other people. The Worker also refuses anything that looks like an email address, a phone, card or account number, a code or a key, whatever the model or the listener sends.
- **How notes are used.** The notes go to the AI provider that writes each new reply, with the conversation, marked as background that may be out of date. They are never part of a shared link, and Live voice doesn't use them.
- **Who can see them.** The listener, in Settings → Memory. Only the Worker reads them; the owner's console shows only how many notes exist in total. The Worker logs counts, never the text.
- **Turning it off.** **Use memory** off stops using and learning notes; **Learn from my chats** off keeps using the notes but learns nothing new. An **incognito chat** (the hat-and-glasses button at the top of a new chat) neither uses nor adds to memory; it is still saved like any chat. The owner can also turn memory off for everyone.
- **How long, and how to delete it.** Until the listener deletes it. Delete removes one note, **Forget everything** removes them all at once, and deleting the account removes the notes and the switches. Deleting a chat does not delete the notes learned from it; delete those in Settings → Memory.

### Shared VinaX AI chats

Share in a chat's header makes a link (`/vinaxai/share/<id>`) that anyone who has it can open, signed in or not. Nothing is shared until the listener presses **Create link**.
- **What is stored.** A copy of the chat as it is at that moment (`ai_shares`; [database.md](database.md)): the title, and for each turn of the branch on screen its text (artifacts are part of a reply's text), the web sources it cited, and the time. Files the listener added appear by name and type only; their contents and the stored files are never part of it. VinaX AI's reasoning, the model that answered, token counts and the listener's name, email or picture are not stored with it or shown.
- **Who can see it.** Anyone with the link. The id is 128 random bits, so a link cannot be guessed, and the page and its API answer tell search engines not to index it. The owner's account id is never sent to readers. A reader who is signed in can **Continue this chat**, which copies the shared turns into a new chat of their own; the original is never changed.
- **How long.** Until the listener stops sharing, deletes the chat, or deletes the account. Messages sent after the link was made are not added; **Update link** replaces the copy with the chat as it is then, under the same link.
- **How to delete it.** **Stop sharing** in the chat's Share dialog, or in VinaX AI's settings under Your chats → Shared links, deletes the copy at once. Deleting the chat deletes its link at once too, and deleting the account removes every link. A copy a reader's browser already loaded may stay on their screen, and their browser may keep it for up to a minute.
- Readers can report a shared chat by email from its page.

### VinaX AI projects

A project groups chats under a name, with instructions and files every chat in it uses. Nothing is made until the listener presses **New project**.
- **What is stored.** With the account (`ai_projects`; [database.md](database.md)): the project's name, its description, its instructions (up to 8,000 characters), whether it is starred, and when it was made and changed. Its files are stored like files added to a chat, in the same private Storage bucket that only the Worker can read, with the text read out of a text file or a PDF (at most 20 files and 200,000 characters of text per project). Each chat records which project it is in.
- **Where it goes.** With every message in a chat in the project, the Worker sends the project's name, instructions and files to the AI provider that answers, as part of that request, the same way a chat's own files are sent (a PDF may go to Google's file service for up to 48 hours, as with a chat's PDFs). They are not copied into the chat's messages, not logged, and never part of a shared link: a link shows the chat's messages only.
- **How long.** Until the listener removes a file, deletes the project, or deletes the account.
- **How to delete it.** Remove a file with its bin button on the project's page. **Delete project** deletes the project, its instructions and its files at once; its chats stay as ordinary chats unless **Delete them too** is picked, which deletes them like any deleted chat (hidden at once, removed within a day, shared links gone at once). Deleting the account removes every project and file.

Settings → Your data → **Export VinaX AI chats** downloads every chat, with all its versions, and every project with its instructions and its files' names, as one JSON file (`GET /api/ai/export`). The file is separate from the app's backup: the chats already live with the account, so a backup neither carries nor restores them.

On first launch after the AI features were removed, the app erases what they left on the device (`services/storage/earlyMigrations.ts`): the AI chats (`vinax_ai_chats_v1`), every `vinax.ai.*`, `vinax.aiplaylist.*` and `vinax.ai<Name>` key, the AI shelf and metadata caches, the old DJ's already-surfaced list, the embedding model name, and the `vinax-embeddings` IndexedDB database.

### Only with usage sharing on

| What | Goes to | What is sent |
| --- | --- | --- |
| Usage events (`/api/events`) | The Worker, which stores them in `events` and keeps the device's latest state in `listeners` | Install id, signed id, the display name when one is set, event type, platform, app version, and for song events the song's id, title, first artist, language and artwork URL. Types: register, open, play, pause, heartbeat, skip, complete, favourite, dislike, playlist add, share, download, lyric miss, error (with a short message), web vitals, and search — which carries the search words (up to 80 characters) and the result count. The Worker never stores the install id: the row is keyed by a server-derived device id (`_lib/identity.ts`), and the Worker adds country, region and city from the edge; the network address itself is not stored. Events without the `x-vinax-consent` header are dropped. |
| `rec_served` and `rec_outcome` (`/api/events`) | The Worker | The common fields above, no song, and a small `meta` record: who picked an automatic continuation, how long it took, how many songs, and whether each added song was finished or skipped (`services/analytics/recTelemetry.ts`). |
| Session insights | A third-party session-analytics provider | Layout, taps and scrolls. All on-screen text is masked on the device before upload. Production builds only; advertising storage is signalled as denied. |

A `play` is sent only when the play counts: at least 5 seconds heard, or 70 % of a shorter song, once per run.

## The usage-sharing choice

| Question | Answer |
| --- | --- |
| Where is it asked? | On the welcome sheet's languages step. The checkbox starts ticked and says it is on by default (`useState(true)` in `OnboardingSheet.tsx`). |
| Where is it stored? | `vinax.analytics-consent` on the device; absent means on. `vinax.usage-sharing-default-on.v1` marks the one-time switch of pre-14.0.3 devices. Session insights: `vinax.session-insights-consent.v1`, absent means off. |
| What does it turn on? | Usage events only. Session insights have their own switch. Nothing else. |
| How is it enforced? | `consented()` is read on every send. Each event carries an `x-vinax-consent` header and the Worker ignores events without it. `sessionInsightsConsented()` gates the third-party tag. |
| What still happens when it is off? | Every functional request in the tables above. |
| Where can it be changed? | **Settings → Region & Privacy → Share anonymous usage** (off at once) and **→ Session insights** (off after the next reload). |
| Do backups carry it? | No. A restore never writes it. |
| Does device transfer carry it? | Yes. |

Rows already sent while sharing was on stay on the server after it is turned off, until the retention purge (below) or a deletion removes them.

## Advertising

VinaX shows no advertising. No page, on the web or in the Android app, loads an advertising script, and the site's Content-Security-Policy (`frontend/public/_headers`) allows no advertising hosts. The Google AdSense slot, its ownership tag and `/ads.txt` were removed.

## Server-side records

Everything the server keeps about listeners is in one database ([database.md](database.md)). Table by table:

| Table | Contents | Removed when |
| --- | --- | --- |
| `listeners` | One row per device that shared usage or claimed a handle: a server-derived device id (never the install id), display name, handle, platform, app version, edge country/region/city, what is playing now, first and last seen | The owner deletes the person from the console |
| `accounts` | Signed-in listeners: Google id, email, name, picture, the linked device, coarse sign-in facts, times | **Delete account** in the app, or the owner's delete |
| `account_backups` | The synced copy (the backup-file JSON), its version and size | With the account |
| `ai_projects` | A VinaX AI project: the account, name, description, instructions, starred, times. Its files are `ai_attachments` rows (and stored files) marked with the project | **Delete project** (its files at once; its chats kept or deleted, as chosen), or with the account |
| `ai_shares` | A shared VinaX AI chat: the account and chat it came from, the title, and a copy of the turns on screen (text, cited sources, file names; no reasoning or file contents) | **Stop sharing**, deleting the chat (at once), or with the account |
| `ai_memories` | VinaX AI's memory notes: the account, the note (≤ 200 characters, at most 50), learned or added, the chat it came from (cleared when that chat is deleted), times | **Delete** or **Forget everything** in VinaX AI's settings → Memory, or with the account |
| `ai_memory_prefs` | The account's memory switches: Use memory, Learn from my chats | With the account |
| `personal_taste` | The account's taste model: scores for artists, languages, moods, decades, hours and songs, a summary, the mode, the vector | With the account, or **Erase my taste model** |
| `personal_events` | The listener's reported events (kind, time, song id, seconds heard, source, local hour and weekday, time zone) | Purged after a year by housekeeping (`personal_purge`), with the account, or on erase |
| `personal_exposure` | Per account and song: how often shown, queued, played, completed, skipped; liked, disliked; when | With the account, or on erase |
| `personal_pages` | The composed Home pages and the playlists the account asked for (the request text, the songs, which model shaped it) | Pages a day past their expiry by housekeeping, with the account, or on erase |
| `personal_songs`, `personal_colisten` | The shared song pool (catalogue facts, facets, community play counts, the embedding; a device's facts never overwrite a row the catalogue confirmed) and which songs listeners play together; no account attached | Nothing about a person; the trending figure counts listeners, not plays; co-listening is rebuilt once a day from the last 30 days of plays |
| `events` | Usage events as listed above; written only with usage sharing on | Purged after `retention.eventsDays` (default 180) by the hourly housekeeping job, on the owner's purge, or with the person |
| `feedback` | Message, type, name, device id, platform, version, country, city, status, the owner's note | The owner resolves and deletes it; a deleted person's feedback stays but is detached from them |
| `push_devices` | Endpoint and keys or token, platform, language, time-zone offset, edge country/region/city, active flag, last pushed | Marked inactive on unsubscribe or after 180 days without a check-in; not deleted by those paths |
| `rooms`, `room_members` | Room state; member rows (device id, name, last seen, reaction) | The room and its members when the host ends it; a member row on leave; rooms idle 6 hours and members unseen 1 day by housekeeping |
| `notifications` | What the owner sent (title, body, link, audience filter, delivery counts); nothing about who received it | The owner retracts it (kept, marked) |
| `settings`, `experiments`, `audit_log`, `uptime_*`, `job_runs`, `blocked_content`, `meta` | The owner's published settings and their history, experiments, the owner's own actions, the status history, job runs, blocked content, the schema version | Nothing about listeners |
| Device-transfer relay (`HANDOFF`, outside the database) | Ciphertext | After ten minutes, or on first read |
| Generated songs (`GENERATED_AUDIO`, or `HANDOFF` under `gen:`) | Each job (the account id that started it, its status, length, mood, language, title) and the finished audio; per day, a count under a hash of the install id and the day, and one under a hash of the account and the day | The job and the audio after 24 hours; the counts after two days |
| Rate limiting (isolate memory and bindings) | Counters keyed by route and a hash of the network address, hashed with a server-side pepper (`_lib/ratelimit.ts`) | Short-lived counters; the raw address is not part of the key |

Three deletion paths exist. **The listener** erases their taste model from Settings → Region & privacy, which removes every `personal_*` row of theirs, or deletes their account from Settings → Profile, which removes `accounts`, `account_backups`, their VinaX AI chats, projects, shared links and memory, and every `personal_*` row for them. **The owner** deletes a person from the console's Listeners page, which removes their device row, every usage event, room memberships, the account and its backup, and detaches their feedback; the reason is kept in the audit trail. The owner's **Database → Maintenance** tab can also purge usage events older than a chosen number of days for everyone.

## The backup file

**Settings → Your Data** exports one JSON file:

```json
{
  "format": "vinax-backup",
  "schemaVersion": 2,
  "app": "vinax",
  "appVersion": "…",
  "exportedAt": "…",
  "categories": { "<category id>": { "<storage key>": "<value>" } }
}
```

| Category id | Label in the app | Contents |
| --- | --- | --- |
| `settings` | Settings & preferences | `vinax.settings.v1` (theme, app style, accent, playback, sound, languages, accessibility and recommendation choices; the inferred region is dropped) and the region key |
| `library` | Library | Favourites, playlists, Listen Later, saved albums and artists, hidden songs |
| `smartCollections` | Smart collections | Saved rules that build playlists from the local library |
| `history` | Listening history | The last 150 plays with completion marks |
| `taste` | Taste profile | The taste profile and the Kid-mode profile |
| `searches` | Saved & recent searches | Search state and the search workspace |
| `bookmarks` | Song bookmarks | Moments marked inside songs |
| `homeLayout` | Home layout | Shelf order, hidden shelves and headline, and the AI Home choices (`vinax.home.ai.v1`: the switch and the shelves marked "Not interested") |
| `identity` | Name & username | Display name, username, the welcome-done flag |
| `extras` | Alarm, lyrics, streak & app preferences | Alarm, lyric offsets, karaoke history, streak, sidebar groups |
| `heard` | Songs you have heard | The lifetime heard-set, as canonical keys (at most 200 000). The export reads it from IndexedDB; a restore hands it to the heard-set, which adds it on the next load. A restore only adds heard songs, in either mode. It is never part of the account sync |

A backup never contains (`BACKUP_EXCLUSIONS`): downloaded audio or download paths; the install id or the signed id; Listen Together host keys; the usage-sharing choice; the queue, playback position or caches; update reminders and the What's New read state. Backups no longer include AI chats, saved AI prompts or AI reply preferences; an older file's `aiChats` section is ignored with a warning.

### Reading a file

`parseBackup()` refuses a file larger than 8 MB, a file that is not JSON, a file that is not a VinaX backup, and a file whose `schemaVersion` is newer than the app understands. Each category is sanitised on its own: a category with the wrong shape is rejected and reported, and the others can still be restored. Settings are filtered to known keys of the right type, so an unknown app style falls back to the default.

### Restore, merge and undo

The **Backup Center** shows what a file holds next to what the device holds, lets the listener pick categories, and offers two modes.

| Mode | Behaviour |
| --- | --- |
| Replace | The chosen categories become what the file says. In `identity`, a missing value never undoes the welcome flow or drops the name the device already has. |
| Merge | Each category unions the file into the device. Library lists merge by id; the same play on both sides is one play; for the taste profile the side that has learned from more plays is kept. |

In both modes:

1. Before writing, the app snapshots every key the restore will touch into `sessionStorage` (`vinax.backup.undo.v1`).
2. All writes go through one batch writer. If the device refuses any write, every key touched so far is put back and nothing is changed.
3. A restored username is written as pending and re-confirmed with the service, unless this device already holds it.
4. After a successful restore the app freezes store writes and reloads.
5. "Undo that restore" stays available until the tab closes and writes the snapshot back the same way.

"Restore a backup" on the Settings page is a replace-mode restore of everything in the file, with the same validation.

### Move to a new device

This is the only path that carries identity. The payload is a backup plus the install id, the signed id, the confirmed username and the usage-sharing choice (`TRANSFER_KEYS`). It is encrypted on the sending device with a key derived from a passphrase (`features/settings/handoff.ts`). Only the ciphertext goes to the relay. The passphrase travels in the QR code's URL fragment, which browsers do not send to servers, or is typed by hand.

## Erasing

| Action | Effect |
| --- | --- |
| Clear history, Clear favorites | Clears the list and offers Undo |
| The personalization reset (`clearPersonalization`) | Resets the taste profile, the recommendation memories and the Home signals; favourites stay |
| Reset app state → Erase everything | Clears the listen-event log, deletes the heard-set database (`vinax-heard`) and the `vinax-embeddings` database older builds kept, and removes every `localStorage` key that starts with `vinax`, then reloads (`resetAppState`) |

`resetAppState` does not itself clear the downloaded-audio cache or `sessionStorage`. Nothing on the server is removed by a local erase: usage rows sent while sharing was on, feedback, a claimed username and push registrations remain until the retention purge or a deletion ([Server-side records](#server-side-records)). **Delete account** is the listener's path to removing the server copy of their account and synced data.

## Secrets

The frontend holds no secrets. `VITE_*` variables are visible to every visitor and must never carry keys. The database URL and service-role key, the admin password, the device-id signing secret, push keys and the optional cron secret are Worker secrets, handled in [operations.md](operations.md). The database's public anon key is never used: every table has row-level security forced with no policy, so it can read nothing.

## Changing what is collected

`services/analytics/telemetry.ts`, `services/analytics/recTelemetry.ts` and `services/analytics/sessionInsights.ts` gate on the same choice; `services/personal/reporter.ts` gates on the personal engine's switch. Any change to what they send, or adding advertising, must be reflected in `frontend/src/pages/PrivacyPage.tsx` and in this document in the same change.
