# Data and privacy

This document says what VinaX keeps on a listener's device, what leaves the device (when, to what kind of service, and under which setting), what the usage-sharing choice controls, what the AI features send, and how backup, restore, device transfer and erasing behave. It is written from the code: the storage registry (`frontend/src/constants/storage-keys.ts`), the backup module (`frontend/src/features/settings/backup.ts`), the network clients under `frontend/src/services/` and `frontend/src/features/`, and the Worker routes under `backend/worker/functions/api/`. The listener-facing version is [user-guide/library-and-backup.md](user-guide/library-and-backup.md); the in-app text is `frontend/src/pages/PrivacyPage.tsx`.

## The short version

- **No accounts.** Library, history, settings, the taste profile and AI chats live on the device. The service keeps no copy, so clearing site or app data removes them; the app offers an export.
- **Features that need the network send what they need.** Browsing sends search words and ids to the catalogue source. AI features send a bounded summary of taste and recent listening (song titles and artist names) with no install id and no name attached. Listen Together, usernames, feedback, notifications and device transfer each send the fields listed below.
- **Usage statistics are opt-in.** The checkbox on the welcome sheet is unticked by default. While it is off, no usage events and no session insights are sent.
- **The web app shows advertising on some browsing pages.** Those pages load a third-party advertising script, and that is not controlled by the usage-sharing choice. See [Advertising](#advertising).
- **The server keeps short technical records.** AI calls are logged as counts and timings without prompts or replies. Rate limiting keys on a hashed network address, not the address itself.

## What is stored on the device

| Where | What | Notes |
| --- | --- | --- |
| `localStorage`, registry keys (`vinax.*`) | Settings (`vinax.settings.v1`, which includes the app style as `template`), player state and queue, library, history (last 150 plays), search state, taste profile and the separate Kid-mode profile, region, welcome-done flag, last-seen version, name, username and pending username, alarm, lyric offsets, karaoke history, weekly mix, output choice, downloads index, room host keys, update reminders, the install id (`vinax.device-id`), the signed id issued by the service (`vinax.signed-device-id`), the usage-sharing choice (`vinax.analytics-consent`) | `constants/storage-keys.ts` is the registry. |
| `localStorage`, feature keys (`vinax.*`) | Bookmarks, smart collections, search workspace, streak, sidebar groups, Home layout, Home signals (`vinax.home.signals.v1`), recommendation memories (`vinax.recs.outcomes.v1`, `vinax.recs.seedmemo.v1`, `vinax.recs.exposure.v1`, `vinax.recs.snoozed.v1`), the DJ's already-surfaced list, AI shelf caches, AI Playlist rounds and avoid list, dismissed banners, the embedding model name (`vinax.embed.model.v1`) | Each feature owns its key next to the registry. |
| `localStorage`, VinaX AI | Chats (`vinax_ai_chats_v1`), projects (`vinax.ai.projects.v1`), memory lines and the memory switch (`vinax.ai.memory.v1`, `vinax.ai.memoryOn`), the place connector (`vinax.ai.placeOn`), the code tool switch (`vinax.ai.codeOn`), chat style (`vinax.ai.chatStyle`), reply language, reply style, profile text, font size, default mode, saved prompts, voice, last and recent models | Attachments are stripped from chats before saving. A temporary chat is never written. |
| `sessionStorage` | Boot and chunk-reload counters, the restore Undo snapshot (`vinax.backup.undo.v1`), this session's Home order, session intent, and the live Listen Together session (`vinax.together.session.v1`: mode and room code, so a reload rejoins) | Gone when the tab closes. |
| IndexedDB `tarang-db` | The listen-event log behind taste insights | `services/storage/idb.ts`. |
| IndexedDB `vinax-embeddings` | Song vectors from the embedding route: song id, model name, vector, time stored; at most 5,000 songs | `services/ai/embeddings.ts`. The vectors describe songs, not the listener. |
| Cache storage `vinax-shell-*` | App shell and build assets | Managed by the service worker. |
| Cache storage `vinax-audio-v1` | Downloaded songs | Not cleared by a service-worker update or by boot recovery. |
| Android app storage | Downloaded audio files | Android only; paths are in the downloads index. |

Every persisted store writes through the guarded layer described in [architecture.md](architecture.md#stores-and-persistence): a full device shows one warning instead of breaking playback, and writes are frozen between a restore and its reload.

The app style and the chat style are display preferences only. No request builder and no usage event reads them, so neither is sent anywhere.

## What leaves the device

"The Worker" below is VinaX's own backend. Fields are listed as the clients build them.

### Always-on functional requests

| When | Goes to | What is sent |
| --- | --- | --- |
| Browsing, searching, opening a song, album, artist, playlist, chart or video page | The catalogue source, directly or through the Worker's catalogue routes | Search words, ids, language and page parameters |
| Playing a song | The audio host named in the song's stream URL | A normal media request |
| Showing artwork | The artwork host; the Worker's image route only when a share card needs a same-origin copy | Image URLs |
| Opening lyrics | An open lyrics database, then the catalogue source as fallback | Track title, artist and duration |
| App config, flags, festival window, announcements, blocklist, site mode, version and update check, experiment list, model and voice lists, trending searches | The Worker | Nothing personal |
| Trends shelves (`/api/trends`) | The Worker | A two-letter region code, a language and a limit, when set |
| Region guess (`/api/geo`) | The Worker | Nothing beyond the request itself. The answer is a country code, a region name, the edge's approximate city and a time zone. Asked only while region inference is allowed (`allowRegionInference` in settings) and no manual override is set, and at most once every 12 hours unless the listener refreshes it. The answer is cached on the device under the region key. |
| Choosing a username (`/api/username`) | The Worker | The username, display name, install id, the signed id when one exists, and the current username when changing it. Checking availability sends only the candidate username. |
| Sending feedback (`/api/feedback`) | The Worker, which stores it | Message and its type, platform, app version, the display name when one is set, and the install id when one exists. The Worker adds country and city from the edge. |
| Turning notifications on (`/api/push/*`) | The Worker, which stores it | Web: the browser's push endpoint and keys, the app language and the time-zone offset. Android: the push token, the platform, the app language and the time-zone offset, plus the country, region and approximate city the edge reports for the request (`backend/worker/functions/api/push/fcm-register.ts`). Turning them off sends the endpoint, and the Worker marks that registration inactive. |
| Listen Together (`/api/room`) | The Worker, which stores the room | Room code, display name, the playing song, upcoming songs and the playback position. Hosts push on every change and as a keep-alive; guests poll, send a heartbeat with the install id, and send a leave beacon when the tab closes. A song request carries the song's id, title, artwork and the guest's name; a reaction carries one emoji from a fixed list. Only the host's key unlocks member names; guests see a count. Ending the room deletes the room and its member rows; leaving deletes that member's row. |
| Move to a new device (`/api/handoff`) | The Worker's short-lived relay | Ciphertext only. Kept at most ten minutes and deleted on first read. |
| Casting to another device | A cast framework script, loaded from its vendor only when the device picker is opened (web only) | A normal script request |

The install id is a random value created on the device the first time something needs it: claiming a username, joining or hosting a room, or sending a usage event. It is never attached to AI requests.

### AI features

Each route goes to the Worker, which forwards the request text to hosted AI model endpoints run by third parties and returns the answer. None of these requests carries the install id, the signed id, the display name or the username. The recommendation routes are skipped while **AI in recommendations** is off in Settings.

| Feature (route) | What is sent |
| --- | --- |
| DJ ordering and queue extension (`/api/dj`) | The seed song; preferred and muted languages (up to 5 each); a pinned mood or tune instruction; up to 12 recently played, 10 finished, 10 skipped and 15 liked song lines; top artists and languages; taste-dial lines; up to 40 candidate songs described by title, artist, album or film, year and whether the listener knows them |
| Home AI shelves and ranking (`/api/curate`) | A task name with candidate songs and a taste summary |
| AI Playlist and AI Radio (`/api/playlist`) | The prompt, languages, the taste snapshot and titles to avoid |
| Search understanding (`/api/ai/search`, and the search helper on `/api/vinaxai`) | The search words (up to 200 characters) and up to three preferred languages |
| Embeddings (`/api/embed`) | Search words, or short text descriptions of songs built from catalogue details such as title, artists, album and language. Candidate songs, favourites and recent plays can be described this way. |
| Lyrics tools (`/api/lyrics-tools`) | The lyric lines being translated, transliterated or explained (up to 80 lines for an explanation) |
| VinaX AI chat (`/api/vinaxai`) | See below |
| Read-aloud and the DJ voice (`/api/tts`) | The text to speak and the chosen voice |
| Dictation (`/api/transcribe`) | The audio recording, its type and an optional language |
| Image or music creation (`/api/image`, `/api/music`) | The prompt and the chosen model |

A VinaX AI chat message sends:

- the conversation so far, trimmed oldest-first when long, and the reply preferences (language, style);
- the taste snapshot (`services/ai/taste.ts`): time of day, day of week, a session mood and energy label, a festival label when one is on, up to 5 preferred and 5 avoided languages, up to 10 top artists, up to 8 top songs, 8 liked songs and 10 recently played songs (each line is "title — artists", at most 90 characters), taste-dial lines, and the songs already recommended in this chat;
- the profile text the listener wrote in VinaX AI settings, when there is one;
- attached images (up to 6 per message), and the text of attached text files and PDFs. PDF text is extracted on the device (`features/ai/pdfText.ts`); the file itself is not uploaded. Each file contributes at most 6,000 characters, within one budget per message. A scanned, encrypted or unreadable PDF sends nothing, and the composer says so;
- only while each is switched on: the listener's memory lines; a project's instructions and reference files; the playing song's details with up to 40 lyric lines; and the coarse place (below).

**Place.** A chat request may carry a country code, a region name, the edge's approximate city and a time zone, so dates and times in answers fit the listener. The rule lives in `services/location/assistantPlace.ts`: with a manual override, the chosen country and region go with the device time zone and never a city; with region inference allowed, the inferred values go, or the time zone alone when nothing has been resolved yet; with inference off and no override, nothing is sent. Switching the Place connector off in the composer (`vinax.ai.placeOn = '0'`) sends no place at all. The Worker keeps only those four fields (`_lib/place.ts`) and stores none of them.

**What the server records about AI calls.** One row per call in `vinax_ai_events`: feature name, model name, success flag, status, error code, client kind (web or app), latency, and token counts when the model endpoint reports them. Prompts, replies, attachments and taste summaries are not written to it. What the third-party model endpoints retain is governed by their own terms and cannot be checked from this repository.

### Only with usage sharing on

| What | Goes to | What is sent |
| --- | --- | --- |
| Usage events (`/api/events`) | The Worker, which stores them | Install id, signed id, the display name when one is set, event type, platform, app version, and for song events the song's id, title, first artist, language and artwork URL. Types: register, open, play, pause, heartbeat, skip, complete, favourite, dislike, playlist add, share, download, lyric miss, error (with a short message), web vitals, and search — which carries the search words (up to 80 characters) and the result count. The Worker adds country, region and city from the edge; the network address itself is not stored. |
| `rec_served` and `rec_outcome` (`/api/events`) | The Worker | The common fields above, no song, and a small `meta` record: who picked an automatic continuation, how long it took, how many songs, and whether each added song was finished or skipped (`services/analytics/recTelemetry.ts`). |
| Session insights | A third-party session-analytics provider | Layout, taps and scrolls. All on-screen text is masked on the device before upload. Production builds only; advertising storage is signalled as denied. |

A `play` is sent only when the play counts: at least 5 seconds heard, or 70 % of a shorter song, once per run.

## The usage-sharing choice

| Question | Answer |
| --- | --- |
| Where is it asked? | On the welcome sheet's languages step. The checkbox starts unticked (`useState(false)` in `OnboardingSheet.tsx`). |
| Where is it stored? | `vinax.analytics-consent` on the device. |
| What does it turn on? | The two rows above: usage events and session insights. Nothing else. |
| How is it enforced? | `consented()` is read on every send. Each event carries an `x-vinax-consent` header and the Worker ignores events without it. |
| What still happens when it is off? | Every functional and AI request in the tables above, and advertising on the web. |
| Where can it be changed? | **Settings → Region & Privacy → Share anonymous usage**. Turning it off stops new events at once; session insights stop after the next reload. |
| Do backups carry it? | No. A restore never writes it. |
| Does device transfer carry it? | Yes. |

Rows already sent while sharing was on stay on the server after it is turned off.

## Advertising

On the web, the song, artist, album, language-hub and mood-hub pages end with one advertising slot (`frontend/src/components/AdSlot.tsx`). The first time such a page is opened, the browser loads a script from a third-party advertising network, which then makes its own requests and may set its own cookies. The slot is not rendered — and no advertising script loads — in the Android app or in Kid mode, and it does not appear in the player, the queue or VinaX AI.

Advertising is not gated on the usage-sharing choice. VinaX passes the advertising network no listening data: nothing from history, favourites, the taste profile or AI chats is handed to it. Asking for consent to advertising cookies in regions that require it is done by the advertising network's own prompt, not by code in this repository.

## Server-side records

| Record | Contents | Removed when |
| --- | --- | --- |
| Usage events | As listed above; written only with usage sharing on | No removal path in the app |
| Feedback | Message, type, name, install id, platform, version, country, city | No removal path in the app |
| Usernames | Username, display name, a device id derived or signed by the server | No removal path in the app |
| Push registrations | Endpoint and keys or token, language, time-zone offset; for Android tokens also the country, region and approximate city the edge reports | Marked inactive on unsubscribe, not deleted by that route |
| Listen Together rooms | Room state and member rows (install id, name, last seen) | The room and its members when the host ends it; a member row on leave. No timed purge was found in the Worker routes. |
| Device-transfer relay | Ciphertext | After ten minutes, or on first read |
| AI call log | Counts and timings, no content | No removal path in the app |
| Rate limiting | Counters keyed by route and a hash of the network address, hashed with a server-side pepper (`_lib/ratelimit.ts`) | Short-lived counters; the raw address is not part of the key |

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
| `homeLayout` | Home layout | Shelf order, hidden shelves and headline |
| `identity` | Name & username | Display name, username, the welcome-done flag |
| `extras` | Alarm, lyrics, streak & app preferences | Alarm, lyric offsets, karaoke history, streak, sidebar groups, saved AI prompts, and the AI preferences: default mode, profile text, font size, reply language, reply style and chat style |
| `aiChats` | VinaX AI chats | Conversation history without attachments or temporary chats |

A backup never contains (`BACKUP_EXCLUSIONS`): downloaded audio or download paths; the install id or the signed id; Listen Together host keys; the usage-sharing choice; the queue, playback position or caches; update reminders and the What's New read state. VinaX AI projects and memory lines are not in any category either.

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
| Reset app state → Erase everything | Clears the listen-event log, deletes the `vinax-embeddings` database and removes every `localStorage` key that starts with `vinax` (AI chats included), then reloads (`resetAppState`) |

`resetAppState` does not itself clear the downloaded-audio cache or `sessionStorage`. Nothing on the server is removed by a local erase: usage rows sent while sharing was on, feedback, a claimed username and push registrations remain.

## Secrets

The frontend holds no secrets. `VITE_*` variables are visible to every visitor and must never carry keys. Model-endpoint keys, the database service key, the admin password, push keys and the cron secret are Worker secrets, handled in [operations.md](operations.md).

## Changing what is collected

`services/analytics/telemetry.ts`, `services/analytics/recTelemetry.ts` and `services/analytics/sessionInsights.ts` gate on the same choice. Any change to what they send, to what an AI request carries, or to where advertising appears must be reflected in `frontend/src/pages/PrivacyPage.tsx` and in this document in the same change. [ai.md](ai.md) lists each AI route's contract.
