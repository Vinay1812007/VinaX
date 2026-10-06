# Listen Together

This page covers listening with friends: hosting a session, joining one, the Live pill that keeps you in the room on every page, what "Tap to start listening" means, adding songs and reacting, and ending a session. It applies to the web app and the Android app. Like the rest of VinaX it is free, and a guest needs no sign-up and no app: a browser is enough. The engineering description is in [architecture](../architecture.md#listen-together-100).

## Host a session

1. Open **Listen Together**: from Library, from the menu in the full-screen player (**Listen together**), or from the **Listen Together** tile on Home's first-visit welcome.
2. Press **Start a session**. You get a room code, a QR code and an invite link.
3. Press **Share invite** (it opens your device's share sheet, or copies the link where there is none), let friends scan the QR, or use **Copy code**.
4. Play music as usual, from any page. Everyone in the room hears what you play, at the same moment.

As the host you stay in control: play, pause, seek and skip as usual. The room page shows what everyone hears, the next songs, and how many people are listening (only the host sees their names; guests see a count).

## Join a session

- **With a link:** open the invite link. It joins by itself.
- **With a code:** open **Listen Together**, type the code under **Join a session** and press **Join**.

Your player then follows the host: the same song, at the same moment. VinaX times every phone in the room from the same clock on its server, so guests stay in step without jumping around; if one drifts more than about a second, it quietly catches up. While you follow, VinaX does not build its own queue for you.

### Tap to start listening

Browsers do not let a page start sound on its own — for example when you open an invite link without tapping anything. When VinaX notices that the host is playing and you are not, it shows **Tap to start listening**. One tap, and your player starts at the host's position.

## The Live pill

A session keeps running while you use the rest of VinaX — a host can go to Search to find the next song, a guest can open the lyrics — and it survives a reload of the tab. On every page other than the room itself, a small **Live** pill shows it: "Hosting · 3 listening", "Listening with Asha", or "Reconnecting…" while the connection recovers. Tap it to go back to the room.

If the host's phone stops sending for a minute and a half (a locked screen can do that), guests see that the host went quiet; their player keeps going meanwhile.

## Add songs and react

- **Guests** use **Add a song for everyone** on the room page. The song goes to the host's app, which looks it up and adds it to the shared queue — and says so if a song is not available. A snackbar tells you when your song was sent.
- **The host** uses **Add to the queue** on the same page, or queues songs anywhere in the app as usual.
- **Reactions** — tap an emoji under **React to the music** and it floats up on every screen in the room.

## End or leave

- The host's **End for everyone** closes the room. Guests are told the host ended the session.
- A guest's **Leave session** takes only them out; the room carries on.
- A guest who closes the tab leaves the room. A host who closes the tab without ending it leaves the room open: guests are told the host went quiet, and the host can type the room code again on the same device, within a day, to carry on as host.

## What is shared

While the room lives, VinaX's server keeps the room code, your display name, the song playing, the next few songs and the playback position. Songs guests add carry the guest's name. Nothing about your library, history or taste is shared. See [data and privacy](../data-and-privacy.md).
