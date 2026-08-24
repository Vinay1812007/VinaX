# Import & Export Your Data

*Last updated: v3.8. Applies to web, PWA and Android.*

VinaX is a **login-free, private-by-design** app. Everything you build
up as a listener — favorites, history, taste profile, pinned
languages, playlists, downloads — lives on your device.

That's great for privacy. But it means moving to a new phone, a new
browser, or a fresh install would normally start you from zero. So
VinaX gives you two doors:

- **Export** — snapshot everything to a small JSON file you own.
- **Import** — restore a snapshot on any other device.

Both live under **Settings → Your Data**.

---

## Export

Settings → Your Data → **Export everything**.

Tap the button. VinaX collects every scrap of data it stores locally,
packs it into one file called `vinax-profile-<date>.json`, and
downloads it (web) or offers a Share sheet (Android).

### What's in the file

| Section | What it means | Sensitive? |
|---|---|---|
| `favorites` | Songs you've hearted | Reveals taste |
| `history` | Play log (last 60 days affect taste) | Reveals what you play, when |
| `libraryPlaylists` | Playlists you've saved | Reveals collections |
| `pinnedLanguages` | Language chips you follow | Preference only |
| `profile` | Computed taste weights (genres, moods, hours) | Aggregated summary |
| `settings` | Theme, accent, density, audio quality, sleep timer, sidebar | Preference only |
| `resume` | Where you left off in each track | Behaviour |
| `stats` | Streak counter, listening totals | Aggregate |
| `downloads` metadata | Which songs you've downloaded (not the audio) | Reveals taste |

The file does **NOT** include:

- Cached audio files (those stay on the device you downloaded them on)
- Push subscriptions (each device registers its own)
- Any per-device identifier (the app doesn't have one that leaves the
  device)
- Anything about the AI conversations you had

### Where the file goes

- **Android**: opens the system Share sheet. Save to Files, send to
  yourself over email, drop into cloud storage, AirDrop to a Mac —
  your choice.
- **Web / PWA**: browser download. Ends up wherever your browser puts
  downloads (usually the Downloads folder).

### File size

Typical: **50 KB – 2 MB**, depending on how long you've been using
VinaX. Big enough to email; small enough to fit in a QR code (if
you're clever with an intermediary encoder).

---

## Import

Two paths.

### 1. On the welcome / onboarding screen (fresh install)

When you first install VinaX or clear its data, the welcome sheet has
a small link near the bottom: **"Already have a VinaX profile?
Import it."** Tap it, choose the `.json` file, done — your favorites,
history, language pins and taste profile land in the new install
before you even see the Home shelf.

Behind the scenes, the file is validated (a bad or truncated file is
rejected with a clear message, not silently ignored) and merged into
local storage under the same keys the app already uses.

### 2. From Settings on an existing install

Settings → Your Data → **Import from file**.

**Warning**: importing on an existing install **replaces** what you
already have on the current device. If you want to *merge* rather
than *replace*, the app currently doesn't do that — you'd need to
export your current data first as a backup.

---

## Common flows

### "New phone — move my library over."

1. On the old phone: Settings → Your Data → Export. Share the file to
   yourself (email, cloud storage, AirDrop, whatever).
2. Install VinaX on the new phone.
3. On the welcome screen tap **"Already have a VinaX profile? Import
   it."** Choose the file.
4. Everything shows up. Start playing.

### "Web to Android app."

Same flow. The export from `sirimillavinay.online` in a browser is
byte-for-byte compatible with the Android APK, and vice versa.

### "I want a monthly backup."

There is no auto-backup — see the "Roadmap" section below. For now:
Settings → Your Data → Export, save the file wherever you keep your
backups. Recommended cadence is monthly for most listeners.

### "Two people share a phone."

Not really supported — VinaX has no user accounts. You could export
each person's data, wipe the app, and import whichever profile is
active for the session, but it's clunky. If this is important to you,
please open an issue on GitHub and we'll consider a "profile switcher"
feature.

---

## Erase everything

Settings → Your Data → **Erase everything**.

Nuclear option. Wipes:

- All favorites, history, playlists, pinned languages, resume
  positions, taste profile, stats, downloads metadata.
- All settings back to defaults.
- Push subscriptions (unsubscribes from web push on this device).
- The onboarding flag (so the welcome screen shows again on next
  launch).
- The "last seen What's New" fingerprint (so the current version's
  What's New sheet shows once on next launch).

What it does **NOT** wipe:

- Downloaded audio files still on disk (Android only — cleared via
  Settings → Storage instead).
- Service-worker cache of the app shell (browser handles this via its
  own "Clear site data").

Once done, VinaX behaves exactly like a fresh install.

---

## Privacy and security notes

- The export file contains no encryption. If your listening history
  is sensitive to you, store the file somewhere you'd store other
  personal notes.
- We recommend **not** posting the file publicly — it doesn't include
  any identifiers per se, but the pattern of what you play (rare
  regional artists, specific playlists) can be identifying to someone
  who knows you.
- The `taste profile` object is a computed aggregate — it doesn't
  contain individual play events beyond what's already in `history`.
- No server ever sees this file. Import happens entirely in your
  browser or in the Capacitor WebView on your phone; there's no
  upload step.

---

## Roadmap (not shipped yet)

Two features people ask for regularly:

- **Automatic monthly export** to a folder you choose. Not shipped
  because it needs OS-level file-write permission we haven't wired.
- **Merge-mode import** that unions two profiles rather than
  replacing. Not shipped because "how to handle conflicting settings"
  needs a design pass.

If either is important to you, file an issue on GitHub with your
use case — that's how prioritization happens.
