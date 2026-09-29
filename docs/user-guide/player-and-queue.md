# The player and the queue

This page covers what happens after you tap a song: how the DJ builds the next five, AI Radio, the Smart Queue switch, how Pin a mood and Tune this queue rebuild Up Next, why songs you queue by hand go first, and the player's other tools (resume, sleep timer, A-B repeat, bookmarks). For the recommendation settings see [Discovery modes](discovery-modes.md); for the engineering detail see [recommendations](../recommendations.md).

## Tap a song: the next five

Tap any song, in a shelf, an album, a playlist or search results. With the default settings the song starts alone and the DJ builds what follows from it.

| Rule | What it means |
|---|---|
| Five at a time | A continuation is the next five songs. When a song starts with two or fewer songs left after it, the DJ builds five more from that song, so it can follow what you skip and finish in this sitting. |
| Queue languages | With **Settings → Recommendations → Queue languages** on **Your languages** (the default), the playing song's language leads: it fills the first two slots and at least half of the five, songs from your other languages (the ones you pinned or play most) may follow, never two changes of language in a row, and a language you never chose stays out. **One language** keeps every continuation in the language of the song that started it. Either way the rule is the same in every discovery mode. |
| Familiar first | The first songs are a familiar hand-off. Artists you have never played are introduced later in the five, not at the start. |
| No repeats | A song already in the queue, or another version of it, is not added again. Start again from the same song and the DJ avoids opening with the same songs as last time. |
| Songs that can play | A song the catalogue says it cannot stream is left out, unless you downloaded it. |

The picks come from songs like the one playing, the rest of its album, artists similar to its artist, its genre, your favourite artists and languages, and songs you finished or liked when the DJ picked them before. They lean toward songs that resemble your favourites and what you have played lately. On a DJ pick, **Why this song?** in the song menu says which of these it was.

This behaviour is the setting **Settings → Recommendations → DJ builds every queue** (on by default). Turn it off and playback follows the list you tapped, in order. The DJ also steps aside when Autoplay is off, when repeat is on, and while you are a guest in a Listen Together room. The **Smart Queue** switch on the Queue page sets both at once (see below).

**AI DJ** (same section) lets the AI service order the songs and suggest a few extra ones. Every suggestion is checked against the catalogue and the same rules before it can play. When the AI is slow or unavailable, the on-device order is used; you do not have to do anything.

## AI Radio

AI Radio plays endless music from one starting point. Open it from the **AI Radio** tile on Home, the **AI Radio** card further down Home, **Start AI Radio** on an empty Queue page, or go to `/radio`.

| Start from | What happens |
|---|---|
| **Describe it** | Type a few words, such as “Telugu 90s melodies”, or tap an example. VinaX reads the language, the decade and the mood from your words and finds the first songs in the catalogue. If that finds too little, it asks VinaX AI instead. |
| **Pick a mood** | Melody, Romantic, Dance, Chill, Sad, Devotional, Beats, Classics or New, in your first language. The DJ keeps following that mood for the whole radio. |
| **From a song or artist** | The song playing now, your recent songs and your artists. |

Every song menu also has **Start AI Radio**: that song starts and the DJ keeps adding songs that follow from it. An artist page has it in its ⋯ menu. Starting the same mood or artist again usually opens with different songs. Your skips steer what comes next, and songs you add yourself still go first.

## Smart Queue

**Smart Queue** is a switch on the Queue page. On, it turns on both **Autoplay** and **DJ builds every queue**: the song you start leads and the DJ builds what follows and keeps the music going. Off, it turns off DJ builds every queue and leaves Autoplay as it was, so your list plays in the order you chose; with Autoplay on, similar songs follow when the list ends. The line next to the switch says which of these is happening, and **More in Settings** opens the full settings.

## Songs you queue by hand go first

Every song menu (right-click, long-press, or the ⋯ button) has **Play next** and **Add to queue**. On touch screens, swiping a song row to the right also adds it to the queue.

- Hand-queued songs play before anything the DJ added.
- A rebuild (a tune, a pinned mood, a new batch of five) never removes or reorders them.

On the Queue page every upcoming song says which it is:

| Mark | What it means |
|---|---|
| **DJ pick** | The DJ chose it. A tune, a pinned mood or **Refresh up next** replaces it. The line under it is the DJ's own reason for choosing it. |
| **Added by you** | You added it with Play next, Add to queue, or **Keep this song**. Nothing the DJ does moves or removes it. |
| No mark | It came from the album, playlist or list you tapped. A rebuild replaces these too, and the button says so before you press it. |

These marks last as long as the app is open. After a reload VinaX still has your queue, but not the record of who put each song in it, so the marks are gone until the DJ builds again.

## Keep this song

On a **DJ pick**, the ⋯ menu has **Keep this song**. It stays exactly where it is and becomes yours: the next rebuild, tune or AI refinement leaves it alone. The mark changes to *Added by you*.

## Tune this queue

Tune this queue is a row of one-tap chips. It is on the **Queue** page, under **More options** in the full-screen player, and in the command palette.

| Chips |
|---|
| More energetic · More chill · More romantic · More melody · More beats · Devotional · Heartbreak · More classics · More new · Same language · Switch language · Surprise me |

Tapping a chip rebuilds Up Next at once with songs fetched for that intent, in the playing song's language. What already played, the current song and your hand-queued songs stay. The tune stays active until you start a fresh song. **Surprise me** picks one of the other chips at random. **Switch language** moves the whole stretch to another of your languages; **Same language** leans the picks toward the playing song's language without changing the Queue languages setting.

## Pin a mood

Pin a mood is in the full-screen player, in the **Up Next** tab: Romantic, Energetic, Chill, Melancholy or Devotional.

- Pinning rebuilds Up Next at once with songs fetched for that mood, in the playing song's language.
- The pin holds for 45 minutes. Tap the same chip again to unpin; Up Next goes back to your usual mix.
- Hand-queued songs keep their place.

## The Queue page

Open **Queue** from the queue button in the player or from the command palette.

| Control | What it does |
|---|---|
| The handle (⠿) | Drag to reorder. With a keyboard, focus it and press ↑ or ↓ — the row moves one place, keeps focus, and the new position is read out. |
| ⋯ on a row | Keep this song, Move up, Move down, Clear from here down, Remove — plus everything a song menu offers. Every drag has a button here, so nothing needs a pointer. |
| ✕ on a row | Removes that song, and offers **Undo** for a few seconds. |
| **Refresh up next** | Asks the DJ for a fresh set. The line under it says how many songs it will replace before you press it; songs you added always stay. |
| Sort chips | Reorder the upcoming songs by energy, calm, newest, classics or mood arc. The playing song never moves. |
| **Save as playlist** | Freezes the queue into a playlist you keep. |
| **Smart Queue** | Autoplay and DJ builds every queue in one switch (see [Smart Queue](#smart-queue)). |
| **Build a queue** | Plans a longer session: you say how long, what mood and how the energy should move, review the plan, then add it after the current song or play it. |

If the DJ cannot reach the catalogue, the page says so and offers **Try again**; while you are offline it says the queue keeps playing but new picks need a connection.

## The full-screen player

| Gesture or control | What it does |
|---|---|
| Swipe the artwork left / right | Next / previous song. The artwork follows your finger and slides out when you let go after about 70 pixels of travel, or on a quick flick. Dragging up or down scrolls the page instead. |
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
