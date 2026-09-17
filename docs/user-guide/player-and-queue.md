# The player and the queue

This page covers what happens after you tap a song: how the DJ builds the next five, how Pin a mood and Tune this queue rebuild Up Next, why songs you queue by hand go first, and the player's other tools (resume, sleep timer, A-B repeat, bookmarks). For the recommendation settings see [Discovery modes](discovery-modes.md); for the engineering detail see [recommendations](../recommendations.md).

## Tap a song: the next five

Tap any song, in a shelf, an album, a playlist or search results. With the default settings the song starts alone and the DJ builds what follows from it.

| Rule | What it means |
|---|---|
| Five at a time | A continuation is the next five songs. When a song starts with two or fewer songs left after it, the DJ builds five more from that song, so it can follow what you skip and finish in this sitting. |
| Same language | Every continuation stays in the language of the song that started it, in every discovery mode. |
| Familiar first | The first songs are a familiar hand-off. Artists you have never played are introduced later in the five, not at the start. |
| No repeats | A song already in the queue, or another version of it, is not added again. |

This behaviour is the setting **Settings → Recommendations → DJ builds every queue** (on by default). Turn it off and playback follows the list you tapped, in order. The DJ also steps aside when Autoplay is off, when repeat is on, and while you are a guest in a Listen Together room.

**AI DJ** (same section) lets the AI service order the songs and suggest a few extra ones. Every suggestion is checked against the catalogue and the same rules before it can play. When the AI is slow or unavailable, the on-device order is used; you do not have to do anything.

## Songs you queue by hand go first

Every song menu (right-click, long-press, or the ⋯ button) has **Play next** and **Add to queue**. On touch screens, swiping a song row to the right also adds it to the queue.

- Hand-queued songs play before anything the DJ added.
- A rebuild (a tune, a pinned mood, a new batch of five) never removes or reorders them.

## Tune this queue

Tune this queue is a row of one-tap chips. It is on the **Queue** page, under **More options** in the full-screen player, and in the command palette.

| Chips |
|---|
| More energetic · More chill · More romantic · More melody · More beats · Devotional · Heartbreak · More classics · More new · Same language · Switch language · Surprise me |

Tapping a chip rebuilds Up Next at once with songs fetched for that intent. What already played, the current song and your hand-queued songs stay. The tune stays active until you start a fresh song. **Surprise me** picks one of the other chips at random.

## Pin a mood

Pin a mood is in the full-screen player, in the **Up Next** tab: Romantic, Energetic, Chill, Melancholy or Devotional.

- Pinning rebuilds Up Next at once with songs fetched for that mood, in the queue's language.
- The pin holds for 45 minutes. Tap the same chip again to unpin; Up Next goes back to your usual mix.
- Hand-queued songs keep their place.

## The Queue page

Open **Queue** from the queue button in the player or from the command palette. You can drag to reorder (or use the arrow keys on a row's handle), remove a song, clear the queue from a song down, sort the upcoming songs, and **Save as playlist**. **Build a queue** plans a longer session: you say how long, what mood and how the energy should move, review the plan, then add it after the current song or play it.

## The full-screen player

| Gesture or control | What it does |
|---|---|
| Flick the artwork up / down | Next / previous song |
| Double-tap the artwork's edges | Seek back / forward |
| Double-tap the centre | Like the song |
| Up Next / Lyrics tabs | The coming songs with Pin a mood, or synced lyrics |
| More options | Playback speed, sleep timer, A-B repeat, bookmarks, Tune this queue, Share this moment, ambient mode |
| Drive mode | Large controls and fewer distractions |

**Sleep timer**: 15, 30 or 60 minutes, end of the current song, or after 3, 5 or 10 songs. The last 30 seconds fade out.

**A-B repeat** loops a passage between two points you mark. **Bookmarks** save a moment inside a song so you can jump back to it.

**Ambient mode**: when it is on and the player is left alone for 45 seconds while music plays, the screen settles into artwork and a clock. Tap to bring the controls back.

## Resume where you left off

When you come back to a song you left part-way, VinaX seeks to where you were and shows “Resumed from 2:14”.

| Rule | Value |
|---|---|
| Song length | Longer than 60 seconds |
| Position | Past the first 20 seconds and not within the last 20 seconds |
| How often it saves | About every 5 seconds while playing |
| How many songs are remembered | 80; the oldest drops out |

Positions are stored on this device only and do not move between devices. **Settings → Resume playback** turns the feature off.

Your queue, the current song, repeat, shuffle, volume and playback speed are also remembered between visits.

## History

**History** (from the Library shortcuts) lists what you played, newest first. You can search it, filter by date, remove an entry, or clear the last hour or today. History holds your last 150 plays and stays on this device.
