# Data and privacy

This document says what VinaX keeps on a listener's device, what leaves the device (when, to what kind of service, and under which setting), what the usage-sharing choice controls, and how backup, restore, device transfer and erasing behave. It is written from the code: the storage registry (`frontend/src/constants/storage-keys.ts`), the backup module (`frontend/src/features/settings/backup.ts`), the network clients under `frontend/src/services/` and `frontend/src/features/`, and the Worker routes under `backend/worker/functions/api/`. The listener-facing version is [user-guide/library-and-backup.md](user-guide/library-and-backup.md); the in-app text is `frontend/src/pages/PrivacyPage.tsx`.

## The short version

- **Device first, account second.** Library, history, settings and the taste profile live on the device. A signed-in listener's library, history, taste and settings also sync to their account as one copy. Clearing site or app data removes the device copy; the app offers an export.
- **The personal engine, on while signed in, off with one switch.** Since V2 1.4 a signed-in listener's plays, completes, skips, likes and saves are also reported to a taste model kept with the account on the server, which builds Home, playlists and radio ([personalisation.md](personalisation.md)). Settings → Region & privacy has the switch and **Erase my taste model**; Kid mode never reports. The section [The personal engine](#the-personal-engine) lists every field.
- **Features that need the network send what they need.** Browsing sends search words and ids to the catalogue source. Signed out, or with the personal engine off, nothing about listening goes to an AI service; only what a signed-in listener types into VinaX AI does. Listen Together, usernames, feedback, notifications and device transfer each send the fields listed below.
- **Usage statistics are on by default, off with one switch.** Since 14.0.3 the box on the welcome sheet is ticked and says so; Settings → Region & privacy has the switch. While it is off, no usage events are sent. Devices that onboarded earlier, with the old unticked box, were switched to the default once and told, with the switch one tap away. **Session insights (third-party, masked replays) are opt-in**, their own switch in Settings, off by default.
- **The web app shows advertising on some browsing pages.** Those pages load a third-party advertising script, and that is not controlled by the usage-sharing choice. See [Advertising](#advertising).
- **The server keeps what its features need, in one database, and nothing more.** The tables are listed under [Server-side records](#server-side-records): no IP addresses, no precise location. Usage events are kept for a bounded time and then purged. Rate limiting keys on a hashed network address, not the address itself.

## Your Google account

VinaX needs a Google account: until a listener signs in, every page is the sign-in screen (the Privacy, Terms and Contact pages stay readable). Signing in sends Google's ID token to the Worker, which checks it with Google and stores one row in `accounts`: the Google account ID, email address (and whether Google verified it), name, profile picture address, the linked device (`listener_id`) when the device proves its signed ID, and the time. The device is linked at sign-in or on the app's session check once per load; that check also refreshes the time at most every 10 minutes. The row also holds coarse sign-in facts, written at sign-in and on that same refresh: the edge's geo for the request (`country`, `region`, `city`; the IP address is never stored), `platform` (web, android, ios) and `app_version`. The owner console's Listeners page shows every account with its name, email, profile photo and these facts, whether or not the listener shares usage; plays, searches and favourites reach the server only while usage sharing is on (the default). The Privacy page says so.

**What syncs.** The account also holds one copy of the listener's data in `account_backups`, in the same format as the backup file: settings, library and playlists, smart collections, listening history, taste profile, bookmarks and the Home layout. It is merged into each device the listener signs in on and updated a few seconds after a change; a version number makes two devices merge instead of overwrite each other. **Searches and this device's identity never sync.** The copy is at most 2 MB.

**Session and deletion.** The session is kept on the device and sent only to the Worker's account routes: `/api/auth/*`, `/api/account/*`, `/api/personal/*`, `/api/ai/*`, `/api/profile`, `/api/follow` and `/api/shared-playlist`. **Sign out** forgets it on the device (the data stays on the device and in the account). **Delete account** (Settings → Profile, also reached from the top-bar avatar menu) removes the account row and, with it, the synced copy from the server. On the website the sign-in button and its script load from Google; in the Android app the system's Google account sheet is used.

## What is stored on the device

| Where | What | Notes |
| --- | --- | --- |
| `localStorage`, registry keys (`vinax.*`) | Settings (`vinax.settings.v1`, which includes the app style as `template`), player state and queue, library, history (last 150 plays), search state, taste profile and the separate Kid-mode profile, region, welcome-done flag, last-seen version, name, username and pending username, alarm, lyric offsets, karaoke history, weekly mix, output choice, downloads index, room host keys, update reminders, the install id (`vinax.device-id`), the signed id issued by the service (`vinax.signed-device-id`), the usage-sharing choice (`vinax.analytics-consent`) | `constants/storage-keys.ts` is the registry. |
| `localStorage`, feature keys (`vinax.*`) | Bookmarks, smart collections, search workspace, streak, sidebar groups, Home layout, Home signals (`vinax.home.signals.v1`), recommendation memories (`vinax.recs.outcomes.v1`, `vinax.recs.seedmemo.v1`, `vinax.recs.exposure.v1`, `vinax.recs.snoozed.v1`), dismissed banners | Each feature owns its key next to the registry. |
| `sessionStorage` | Boot and chunk-reload counters, the restore Undo snapshot (`vinax.backup.undo.v1`), this session's Home order, session intent, and the live Listen Together session (`vinax.together.session.v1`: mode and room code, so a reload rejoins) | Gone when the tab closes. |
| IndexedDB `tarang-db` | The listen-event log behind taste insights | `services/storage/idb.ts`. |
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
| A play is counted, a song is completed or skipped, liked or un-liked, marked not interested, saved to a playlist, queued, or played from search (`services/personal/reporter.ts`, from `services/personalization/tasteEvents.ts`) | The Worker, `POST /api/personal/events`, in batches every 15 s, at 25 events, when the page hides and when the connection returns | Per event: a device-minted event id, the kind, the time, the song id, seconds heard and the song's length, which surface it came from (a Home shelf's key and the position on it, radio, search, the playlist maker), and the local hour, weekday and time-zone name. Per song in the batch, once: id, title, artists (with catalogue ids), album, language, year, length, artwork link and the facets the device inferred (mood, genre, vibe, energy, tempo). The batch also carries the Familiar / Balanced / Discover setting. |
| Home opens, or Refresh Home (`features/home/personal/usePersonalHome.ts`) | The Worker, `GET /api/personal/home` | The local hour and weekday, the discovery mode, the active festival's id |
| Make me a playlist (`features/home/personal/PlaylistMaker.tsx`) | The Worker, `POST /api/personal/playlist` | The request text (3–500 characters), the number of songs wanted, the local hour |
| Up Next refills while the engine is on (`services/nextup/engine.ts`) | The Worker, `GET /api/personal/recommend` | The newest anchor song's id, the discovery mode, the local hour |
| Erase my taste model | The Worker, `DELETE /api/personal/taste` | Nothing but the session |

On the server, an event batch is folded into the account's taste model (`personal_taste`: artists, languages, moods, decades and hours as decaying scores, the songs with their scores, a short summary, and a 1024-dimension vector), the songs join the shared song pool (`personal_songs`, no account attached), and what the account was shown or played is kept in `personal_exposure`. Two steps use an AI model: each song's catalogue words (title, artists, album, language, year, facets) are embedded once, which says nothing about any listener; and the Home page and a requested playlist are arranged by one of the models VinaX AI uses, which is given the taste summary's few lines, the hour, the day, the first name and the candidate songs — never the event history. The providers are the ones [ai.md](ai.md) lists. Events are kept for a year; a composed Home page for 30 minutes, a playlist for 30 days. Deleting the account removes all of it; **Erase my taste model** removes all of it and keeps the account.

### AI

Signed out, or with the personal engine off, nothing about listening is sent to an AI service: what plays next, Radio, Home's shelves and the taste profile are worked out on the device ([recommendations.md](recommendations.md)). With the engine on, the section above says exactly what reaches a model. Voice search and Drive mode's voice commands use the browser's or the phone's own speech recognition, and the commands are read by simple rules on the device; VinaX never receives or stores audio, only the words that end up in a search.

VinaX AI ([ai.md](ai.md)), the chat at `/vinaxai`, is the one place AI is used, and only when a signed-in listener uses it:
- What they type goes from the Worker to one of the AI providers to generate the reply. The privacy page names them.
- The chat never sees the listening history or anything outside the conversation.
- When a reply searches the web, the search words (the latest message, with links cut to their site names) go either to Google, through Gemini's Search grounding, or to the search provider (Tavily or Serper). A search's results are cached at the edge for up to an hour, keyed by a hash of the query.
- Conversations are stored with the account (`ai_conversations`, `ai_messages`; [database.md](database.md)), so they follow it to every device.
- A deleted chat is hidden at once and removed within a day. Deleting the account removes every chat.
- Files added to a chat stay with the account, in a private Storage bucket that only the Worker can read. Images are shrunk on the device first; a PDF's text is read on the device. They are sent to the AI provider that answers, and removed with their chat or the account. Files added but never sent are removed after a day.
- The Worker logs only the route, model, provider, latency, status and token counts, never message text.
- Voice is used only when the listener presses a voice button:
  - **Dictation** sends the recorded clip from the Worker to Groq (Whisper), or to Google (Gemini) when Groq cannot take it, and returns the text to the composer. Neither the clip nor the text is stored until the listener sends the message.
  - **Read aloud** sends the reply's words to Groq (Orpheus) or Google (Gemini) and plays the audio. Nothing is stored.
  - **Live voice** streams the microphone from the device straight to Google (Gemini Live), with a one-use token the Worker makes. The key stays in the Worker. What both sides say is saved in the chat as ordinary messages when Live voice closes. The audio itself is not stored.
  - Music pauses while the mic is open.
- The page keeps nothing about the chat on the device.

Settings → Your data → **Export VinaX AI chats** downloads every chat, with all its versions, as one JSON file (`GET /api/ai/export`). The file is separate from the app's backup: the chats already live with the account, so a backup neither carries nor restores them.

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
| What still happens when it is off? | Every functional request in the tables above, and advertising on the web. |
| Where can it be changed? | **Settings → Region & Privacy → Share anonymous usage** (off at once) and **→ Session insights** (off after the next reload). |
| Do backups carry it? | No. A restore never writes it. |
| Does device transfer carry it? | Yes. |

Rows already sent while sharing was on stay on the server after it is turned off, until the retention purge (below) or a deletion removes them.

## Advertising

On the web, the song, artist, album, language-hub and mood-hub pages end with one advertising slot (`frontend/src/components/AdSlot.tsx`). The first time such a page is opened, the browser loads a script from a third-party advertising network, which then makes its own requests and may set its own cookies. The slot is not rendered — and no advertising script loads — in the Android app or in Kid mode, and it does not appear in the player or the queue.

Advertising is not gated on the usage-sharing choice. VinaX passes the advertising network no listening data: nothing from history, favourites or the taste profile is handed to it. Asking for consent to advertising cookies in regions that require it is done by the advertising network's own prompt, not by code in this repository.

## Server-side records

Everything the server keeps about listeners is in one database ([database.md](database.md)). Table by table:

| Table | Contents | Removed when |
| --- | --- | --- |
| `listeners` | One row per device that shared usage or claimed a handle: a server-derived device id (never the install id), display name, handle, platform, app version, edge country/region/city, what is playing now, first and last seen | The owner deletes the person from the console |
| `accounts` | Signed-in listeners: Google id, email, name, picture, the linked device, coarse sign-in facts, times | **Delete account** in the app, or the owner's delete |
| `account_backups` | The synced copy (the backup-file JSON), its version and size | With the account |
| `personal_taste` | The account's taste model: scores for artists, languages, moods, decades, hours and songs, a summary, the mode, the vector | With the account, or **Erase my taste model** |
| `personal_events` | The listener's reported events (kind, time, song id, seconds heard, source, local hour and weekday, time zone) | Purged after a year by housekeeping (`personal_purge`), with the account, or on erase |
| `personal_exposure` | Per account and song: how often shown, queued, played, completed, skipped; liked, disliked; when | With the account, or on erase |
| `personal_pages` | The composed Home pages and the playlists the account asked for (the request text, the songs, which model shaped it) | Pages a day past their expiry by housekeeping, with the account, or on erase |
| `personal_songs`, `personal_colisten` | The shared song pool (catalogue facts, facets, community play counts, the embedding) and which songs listeners play together; no account attached | Nothing about a person; co-listening is rebuilt hourly from the last 30 days of plays |
| `events` | Usage events as listed above; written only with usage sharing on | Purged after `retention.eventsDays` (default 180) by the hourly housekeeping job, on the owner's purge, or with the person |
| `feedback` | Message, type, name, device id, platform, version, country, city, status, the owner's note | The owner resolves and deletes it; a deleted person's feedback stays but is detached from them |
| `push_devices` | Endpoint and keys or token, platform, language, time-zone offset, edge country/region/city, active flag, last pushed | Marked inactive on unsubscribe or after 180 days without a check-in; not deleted by those paths |
| `rooms`, `room_members` | Room state; member rows (device id, name, last seen, reaction) | The room and its members when the host ends it; a member row on leave; rooms idle 6 hours and members unseen 1 day by housekeeping |
| `notifications` | What the owner sent (title, body, link, audience filter, delivery counts); nothing about who received it | The owner retracts it (kept, marked) |
| `settings`, `experiments`, `audit_log`, `uptime_*`, `job_runs`, `blocked_content`, `meta` | The owner's published settings and their history, experiments, the owner's own actions, the status history, job runs, blocked content, the schema version | Nothing about listeners |
| Device-transfer relay (`HANDOFF`, outside the database) | Ciphertext | After ten minutes, or on first read |
| Rate limiting (isolate memory and bindings) | Counters keyed by route and a hash of the network address, hashed with a server-side pepper (`_lib/ratelimit.ts`) | Short-lived counters; the raw address is not part of the key |

Three deletion paths exist. **The listener** erases their taste model from Settings → Region & privacy, which removes every `personal_*` row of theirs, or deletes their account from Settings → Profile, which removes `accounts`, `account_backups` and every `personal_*` row for them. **The owner** deletes a person from the console's Listeners page, which removes their device row, every usage event, room memberships, the account and its backup, and detaches their feedback; the reason is kept in the audit trail. The owner's **Database → Maintenance** tab can also purge usage events older than a chosen number of days for everyone.

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
| `extras` | Alarm, lyrics, streak & app preferences | Alarm, lyric offsets, karaoke history, streak, sidebar groups |

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
| Reset app state → Erase everything | Clears the listen-event log, deletes the `vinax-embeddings` database older builds kept, and removes every `localStorage` key that starts with `vinax`, then reloads (`resetAppState`) |

`resetAppState` does not itself clear the downloaded-audio cache or `sessionStorage`. Nothing on the server is removed by a local erase: usage rows sent while sharing was on, feedback, a claimed username and push registrations remain until the retention purge or a deletion ([Server-side records](#server-side-records)). **Delete account** is the listener's path to removing the server copy of their account and synced data.

## Secrets

The frontend holds no secrets. `VITE_*` variables are visible to every visitor and must never carry keys. The database URL and service-role key, the admin password, the device-id signing secret, push keys and the optional cron secret are Worker secrets, handled in [operations.md](operations.md). The database's public anon key is never used: every table has row-level security forced with no policy, so it can read nothing.

## Changing what is collected

`services/analytics/telemetry.ts`, `services/analytics/recTelemetry.ts` and `services/analytics/sessionInsights.ts` gate on the same choice; `services/personal/reporter.ts` gates on the personal engine's switch. Any change to what they send, or to where advertising appears, must be reflected in `frontend/src/pages/PrivacyPage.tsx` and in this document in the same change.
