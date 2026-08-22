# Replay & Resume — how VinaX remembers where you were

*Last updated: v3.8. Applies to web, PWA and Android.*

VinaX keeps track of where you are inside a song so you can walk away
from your phone, close the tab, or open the app three days later — and
pick right back up.

Everything below happens **on your device**. Nothing about what you
play, or where you paused, ever leaves the phone or the browser tab
you're using.

---

## Resume playback (mid-track)

When you close and reopen VinaX partway through a song, the app
automatically seeks back to the second you left off. You'll see a
one-line toast at the top of the screen: **"Resumed from 2:14"**.

The rules VinaX uses:

- The track must be **longer than 60 seconds** — short clips or SFX
  aren't worth remembering.
- You must have listened past the **first 20 seconds** — otherwise
  we treat it as a false start.
- You must not have been within **20 seconds of the end** — the app
  assumes you finished it.
- We keep the last **80 tracks** you resumed. Older ones age out.

### Turning it off

Settings → Playback → **Resume playback**. Toggle off and every new
play starts at zero. Any already-remembered positions are cleared.

---

## Continue Listening (shelf)

Home page → "Continue Listening" shelf. Six tiles across the top,
followed by a full horizontal shelf below. Both are driven by the
same on-device history.

Tap a card to jump directly into that track at the resume position —
same behaviour as re-opening the song from anywhere else.

The shelf hides itself once you've listened to fewer than two tracks
in the last week, so it never shows up empty.

---

## Playback history

Settings → **Your VinaX** → **History**. Every track you've played,
newest first, with the exact timestamp. Tap any row to play it again;
long-press for the full context menu.

- History is **local-only**. It never syncs to a server, and it never
  includes anything about *when* you were on the app (only what you
  played).
- History **decays after 60 days** for taste-profile purposes — older
  plays still show in the History page but stop affecting your Home
  shelves and AI recommendations.
- The count you see on Home ("*this week: 42 plays ≈ 128 min*") is
  computed live from this local history.

### Clearing history

Settings → Your VinaX → **Erase everything** (see the next guide for
how that works and what it touches).

---

## On Repeat, Repeat Rewind, Most Listened

Three home shelves surface tracks you've been playing frequently:

- **On Repeat** — songs played **3+ times in the last 14 days**. This
  is the "you can't get this one out of your head" shelf.
- **Most Listened Songs** — your top by play-count all-time. Great for
  a "my greatest hits" mood.
- **Repeat Rewind** — songs you played heavily more than 90 days ago,
  and haven't touched recently. Nostalgia mode.

All three are computed from the same local history — no server call,
no sync, no login.

---

## What VinaX does NOT do

- **It doesn't sync resume positions across devices.** If you paused a
  song on your phone, opening the same song on your laptop starts from
  zero. This is a deliberate privacy tradeoff — no accounts means no
  cross-device state.
- **It doesn't remember podcast positions** (VinaX is music-only right
  now — podcasts are on the roadmap, and when they land they'll get
  their own separate resume system).
- **It doesn't tell anyone what you paused on.** Not us, not our AI
  lanes, not the songs' original publishers.

---

## Troubleshooting

**"Resume never triggers."**
Check Settings → Playback → Resume playback is ON. Also check that
the tracks you're playing are longer than 60 seconds — resume is
disabled for shorter clips by design.

**"It resumes to the wrong second."**
The saved position updates every 5 seconds while you listen. If the
app crashed mid-play or your phone force-closed VinaX, up to 5 seconds
of "where you actually were" can be lost. Not preventable without
writing to disk more aggressively (which would kill battery).

**"I imported a profile from another device and my Continue Listening
shelf is empty."**
Exports include your history — but the exported history is used only
to *seed your taste profile*, not to repopulate the Continue Listening
shelf. That shelf only shows tracks *this device* has actually played.
Play a few songs on the new device and it'll fill up.
