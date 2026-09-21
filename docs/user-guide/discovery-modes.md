# Discovery modes

This page explains the recommendation settings a listener can change: Familiar, Balanced and Discover, the intensity slider, the AI switches, pinned languages, and the song-menu choices that steer recommendations. All of them are in **Settings → Recommendations** unless noted. The engineering description is in [recommendations](../recommendations.md).

## What VinaX thinks you like

**Settings → Recommendations** opens with a short summary of what the app believes about you: your top languages and artists, the discovery mode, how confident the profile is, which artists are being played less, and how many are blocked. It is read from this device and never uploaded.

Two buttons sit under it:

- **Pick languages & artists** — the optional setup step. Tap the languages you listen in, then tap artists you love from what is popular in those languages. Each artist you pick counts as much as liking one of their songs. You can open it any time; nothing is recorded until you press Save.
- **See the full taste profile** — the Taste Profile page, with the dials, the bars and the same list of muted artists.

## Familiar, Balanced, Discover

**Settings → Recommendations → Discovery** has three modes, each with its own line saying what it changes. Balanced is the middle setting.

| Mode | What changes |
|---|---|
| Familiar | Mostly songs and artists you already play. New artists are rare. |
| Balanced | Your taste first, with about one new artist in every four or five songs. What you skip and finish in a sitting tips it either way. |
| Discover | Up to half of a queue from artists you have never played. Home adds picks from languages you have not tried. |

Two rules hold in every mode:

1. A queue stays in the language of the song that is playing.
2. A queue opens with a familiar hand-off; new artists come after it.

So Discover changes *how much* is new, not *where* a queue starts or what language it is in. To change language on purpose, use **Tune this queue → Switch language** (see [The player and the queue](player-and-queue.md)).

## What VinaX learns from, in one sitting and over time

| Signal | Effect |
|---|---|
| Finishing a song, liking it, queueing it by hand | Counts for the song, its artist and its language |
| Skipping | Counts against; a skip also takes back the play it would have counted |
| A play | Counts after five seconds of listening |
| This sitting's skips, completions, likes, searches and queue-adds | Steer the current session only; they fade and are not written into your long-term taste |

The taste profile is computed and stored on this device. **Taste Profile** (Library shortcuts) shows what it learned and lets you adjust it.

## The other switches

| Setting | What it does |
|---|---|
| Trending vs. your taste | How much Home and the DJ lean on what is popular right now against your own listening. The line under the slider says what the setting you are on means. |
| AI DJ | Lets the AI service order what plays next and suggest a few extra songs, each checked against the catalogue before it can play. Off keeps the on-device order. |
| DJ builds every queue | Tap a song and the DJ builds what follows. Off makes playback follow the list you tapped. |
| AI-designed shelves on Home | Shows the “Designed for you” block and lets VinaX AI order “Trending for you”. Off hides the block and keeps Trending in your on-device taste order. |
| Kid mode | Hides songs the catalogue marks explicit and keeps a separate taste profile |
| Preferred languages | Pinned languages are boosted everywhere |

## Steering from a song menu

| Menu item | Effect | How long |
|---|---|---|
| More like this | A nudge for this sitting, and the DJ picks are rebuilt at once — towards the song's mood when it has one, otherwise towards its artist | This sitting |
| Less like this… | Asks for 7, 14 or 30 days, then plays that artist less everywhere. If DJ picks by them were already queued, the picks are rebuilt without them | Until the day you chose |
| Why this song? | Shows why a recommended song was picked (appears on recommended songs) | — |
| Not interested | Hides that song | Until you undo it |
| Never play *artist* | Blocks that artist everywhere | Until you allow them again |

The first two steer; the last two block, and they sit in a separate group in the menu. Each shows an **Undo**.

### Artists you are playing less

**Settings → Recommendations → Playing less of** lists every artist under a “Less like this”, with the date each one comes back and how many days are left. **Unmute** ends one (with Undo), **Unmute all** ends them all. The same list is on the Taste Profile page.

The permanent block is a different list: **Settings → Appearance & Playback → Never play**.

## Starting over

**Settings → Your Data → Reset taste profile** (or **Reset personalization** at the foot of the Taste Profile page) erases what VinaX learned: languages, artists, habits, the dials and any “Less like this” mutes. It offers to download a backup first, and says what stays — favourites, playlists, history, the Never play list and your settings. There is no undo, so take the backup.

## Trending for you

Home's **Trending for you** shelf is the current trending pool in the order your taste suggests. With AI-designed shelves on, VinaX AI orders it instead; the shelf's subtitle says which one did. Home shows a song once: a song that appeared in an earlier shelf is left out of later ones.
