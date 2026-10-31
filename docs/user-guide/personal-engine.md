# The personal engine

This page is for listeners who sign in: why Home looks different for you, what the shelves it composes mean, how to ask for a playlist in plain words, what the engine learns from, and how to switch it off or erase what it knows. Signed out, VinaX works exactly as before: everything about what plays next is worked out on your device ([Discovery modes](discovery-modes.md)).

## What you see

Signed in, Home opens with a set of shelves built for you and for the moment, above the usual Home. The titles change, but they come from a fixed set of ideas:

| Shelf | What it is |
| --- | --- |
| **Made for you** | The best of everything the engine knows about you today |
| **Because you liked …** / **Because you played …** | Songs that go with one song you liked or finished recently (up to two of these) |
| **More from &lt;artist&gt;** | Songs you have not heard by one of the artists you play most |
| **&lt;Language&gt; for you** | Your top languages, each on its own shelf |
| **Discover** | Songs you have never played, close to your taste — by what other listeners with your taste play, and by how near a song sits to what you love |
| **Rediscover** | Songs you loved and have not played for three weeks |
| **Morning / Afternoon / Evening / Late night picks** | What you tend to play around this hour |
| **Listeners like you** | What people with your taste are playing |
| **Popular this week** | The most played across VinaX in your languages |
| **New to you this week** | A fresh set of unheard songs, kept for the week |

A line under each shelf says why it is there. VinaX AI arranges the page for the moment: it orders the shelves, writes their titles, may merge two, and may add one shelf of its own for the hour, the day or a festival — always from songs the engine already chose for you, never from thin air. When it cannot answer in time, you get the same shelves with their plain titles.

The page is kept for half an hour; **Refresh Home** (under "Explore more") asks for a new one. In **Kid mode** the personal engine is paused and Home is the on-device one.

## Make me a playlist

The card at the top of the personal shelves opens a box. Say what you want, in your words:

- "Slow songs like the ones I liked last week"
- "Wedding dance songs in Telugu and Hindi"
- "Something new, nothing I have heard"
- "Late-night drive, 90s melodies"

The engine reads your request, searches the catalogue, ranks what fits against your taste, and VinaX AI puts it in order with a title and a line. **Play** starts it; **Save** keeps it as one of your playlists; the circular arrow builds it again. Up to fifty songs; a request takes a few seconds to half a minute. If nothing in the catalogue fits, the box says so — try other words.

## What it learns from

While the engine is on, your device sends what you play, finish, skip, like, un-like, mark as not interested, save to a playlist, queue or play from search — with the song, how long you heard it, the hour and the day on your clock, and which shelf it came from. The server keeps a taste model for your account from these: your artists, languages, moods, decades and hours as scores that fade with time (a like counts three times a play; a skip counts against), and a short summary in words. **Familiar, Balanced and Discover** (Settings → Recommendations) reach the engine too and lean its picks toward artists you know or away from them.

What the engine shows you is also remembered, so Home does not repeat itself from one visit to the next, and what you skip is held back for a while. The full list of what is sent, and what an AI model is given, is in the app's Privacy page and in [data-and-privacy](../data-and-privacy.md).

## Switching it off, erasing it

Settings → Region & privacy:

- **Personal engine** — off stops the reporting at once, clears anything waiting to be sent, and Home goes back to the on-device engine. On again starts from the model the server still has.
- **Erase my taste model** — removes everything the engine holds about your account on the server: the events, the model, the pages it built. Your device's own taste profile stays, and so does your account. The engine starts again from what you play next.

Deleting your account (Settings → Profile) removes all of it as well.
