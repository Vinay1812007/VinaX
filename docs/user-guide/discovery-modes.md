# Discovery modes

This page explains the recommendation settings a listener can change: Familiar, Balanced and Discover, the intensity slider, the AI switches, pinned languages, and the song-menu choices that steer recommendations. All of them are in **Settings → Recommendations** unless noted. The engineering description is in [recommendations](../recommendations.md).

## Familiar, Balanced, Discover

**Settings → Recommendations → Discovery** has three modes. Balanced is the middle setting.

| Mode | What changes |
|---|---|
| Familiar | Your favourites and songs you finished come back into the mix. New artists are rare. |
| Balanced | Mostly your taste, with about one new artist in every four or five songs. What you skip and finish in a sitting tips it either way. |
| Discover | Artists you have never played rank higher and fill close to half of a queue. Home adds picks from languages you have not tried. |

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
| Intensity | Low leans on popular and trending songs; high leans on your own taste |
| AI DJ | Lets the AI service order what plays next and suggest a few extra songs, each checked against the catalogue before it can play. Off keeps the on-device order. |
| DJ builds every queue | Tap a song and the DJ builds what follows. Off makes playback follow the list you tapped. |
| AI-designed shelves on Home | Shows the “Designed for you” block and lets VinaX AI order “Trending for you”. Off hides the block and keeps Trending in your on-device taste order. |
| Kid mode | Hides songs the catalogue marks explicit and keeps a separate taste profile |
| Preferred languages | Pinned languages are boosted everywhere |

## Steering from a song menu

| Menu item | Effect |
|---|---|
| Why this song? | Shows why a recommended song was picked (appears on recommended songs) |
| Not interested | Shows that song less |
| Show fewer like *artist* | Lowers that artist |
| Never play *artist* | Blocks that artist |

Each of these shows an **Undo**.

## Trending for you

Home's **Trending for you** shelf is the current trending pool in the order your taste suggests. With AI-designed shelves on, VinaX AI orders it instead; the shelf's subtitle says which one did. Home shows a song once: a song that appeared in an earlier shelf is left out of later ones.
