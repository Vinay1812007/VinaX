# Backups: export, restore, and moving devices

*Last updated: VinaX 6.1. Applies to web, PWA and Android.*

VinaX is a **login-free, private-by-design** app. Everything you build
up as a listener lives on your device. A backup is how you keep it safe
and carry it somewhere else.

Both live under **Settings → Your Data**. The **Backup Center** there
shows what a backup holds right now, what it leaves out, and when you
last exported or restored.

---

## What a backup includes

A backup is one JSON file (`vinax-backup-<date>.json`, format
`vinax-backup`, schema 2). It holds these categories:

| Category | What it means |
|---|---|
| Settings & preferences | Theme, accent, playback, sound, languages, accessibility, recommendation choices |
| Library | Favourites, playlists (with tags, pins, descriptions), Listen Later, saved albums/artists, hidden songs |
| Smart collections | Your saved rules |
| Listening history | Your last 150 plays, with completion marks and measured minutes |
| Taste profile | The on-device taste summary and the Kid-mode profile |
| Saved & recent searches | Saved search presets, pinned and recent searches |
| Song bookmarks | Moments you marked inside songs |
| Home layout | Shelf order, hidden shelves and headline from Home Studio |
| Name & username | Your display name and the username you chose |
| Alarm, lyrics, streak & app preferences | Wake-up alarm, lyric sync offsets, karaoke history, streak, sidebar groups, saved AI prompts, AI reply preferences |
| VinaX AI chats | Conversation history (attachments are never stored) |

## What it leaves out, and why

- **Downloaded audio and download paths** — files stay on the device that
  saved them; a backup only knows which songs you saved, not the audio.
- **Device identity and the service-issued token** — identity is per
  install. Use **Move to a new device** to carry it across.
- **Listen Together host keys** — credentials for rooms you host here.
- **Usage-sharing consent** — asked again per device; sharing stays off
  after a restore until you turn it on.
- **Queue, playback position and caches** — rebuilt on the next open.
- **Update reminders and What's New read state** — device-specific.

The username in a backup is a *claim*, not a fact: after a restore VinaX
re-confirms it with the service. If it was taken in the meantime you are
asked to choose another.

---

## Export

Settings → Your Data → **Export** (or **Backup Center → Export a backup
now**). The file downloads (web) or lands in your Downloads (Android).
Typical size: 50 KB – 3 MB.

## Restore

### From the Backup Center (recommended)

1. Settings → Your Data → **Backup Center → Choose a backup file…**
2. VinaX reads the file and shows every category it contains next to what
   is on this device. Damaged categories are listed and left out; older
   export formats are migrated automatically.
3. Choose **Merge** or **Replace**:
   - **Merge** keeps everything on this device and adds what the file has.
     The same song, playlist, bookmark or saved search is never added
     twice; settings and the Home layout from the file win.
   - **Replace** makes the chosen categories exactly what the file holds.
4. Untick any category you do not want, optionally **Download a safety
   copy first**, then restore. The app reloads.
5. Changed your mind? Open the Backup Center again in the same tab and
   use **Undo that restore**. (The undo copy lives in the tab until you
   close it.)

If the device is out of storage, nothing is written and you are told so —
a restore is all-or-nothing.

### Quick restore

Settings → Your Data → **Restore a backup (quick)** replaces the
categories in the file without a preview. Onboarding's *"Already have a
VinaX profile? Import it."* does the same for a fresh install.

---

## Moving to a new phone

**Settings → Your Data → Move to a new device** creates an encrypted,
one-use QR handoff. Unlike a backup file, it also carries your device
token, confirmed username and usage-sharing choice, so the new phone is
the old one as far as the service is concerned.

---

## Erase everything

Settings → Your Data → **Reset app state** wipes everything VinaX stores
on this device (the list shown in the app comes from the live storage
registry, so it is always complete) and reloads. Downloaded audio files on
Android and the browser's app-shell cache are managed separately.

---

## Privacy and security notes

- The export file is not encrypted. Store it where you keep other
  personal notes.
- No server ever sees the file: export and restore happen entirely on
  your device.
