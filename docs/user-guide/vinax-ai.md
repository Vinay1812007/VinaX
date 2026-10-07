# VinaX AI

This page is for listeners. It explains how to use VinaX AI, the assistant inside VinaX: choosing a model, the look of the chat, attaching files and pictures, voice, the tools in the + menu, and what to do when a reply does not arrive. Open it from the app's navigation; it needs no sign-up.

## Ask something

Type in the box and send. The reply appears as it is written; press Stop to end it early. Under a reply you can copy it, ask for it again, or have it read aloud. If you ask for music, the songs in the reply can be played or queued directly.

## Pick a model, or leave it on Auto

The model chip opens the model menu. **Auto** picks a model for each question and moves to another one by itself if the first is busy. Below it are the models you used recently, then every free model from NVIDIA, OpenRouter, Groq and Gemini that is available right now, under its real name. Use the search field to find one.

- Choose a model when you want one in particular. If it later disappears from the list, the chat tells you "That model is no longer available — switched to Auto." and carries on with Auto.
- To start every chat with the same model, open chat settings → **General** → **Default model**.

## Chat style

The chat changes its look to suit the maker of the model you picked: the shape of the message box, where the greeting sits, how messages are drawn, and the colours. Auto uses the VinaX look.

To change it, or to stop it changing: open chat settings → **General** → **Chat style**.

- **Match the model** (the default) — the chat follows the model you pick.
- **Always VinaX** — the VinaX look whatever the model.
- **Mono, Spectrum, Paper, Loop, Void, Forge, Circuit, Deep** — one fixed look.

If the chat suddenly looks different, you changed model; choose **Always VinaX** to keep one look. The choice is kept on this device and is part of a backup.

## Attach files and pictures

Use the + menu, or drag files onto the chat.

- **Pictures** — up to 6 per message, 4 MB each. Some models read only one picture at a time; when you send several, VinaX AI asks a model that can read them all first.
- **Text and code files** — up to 2 MB each.
- **PDF** — up to 8 MB. The text of the PDF is read on your device and sent with your message. A scanned PDF has no text to read; you are told so, and can paste the part you need instead.
- Up to 24 files per message.

Attached files show as small chips on your message. Choose **Show contents** on a chip to see exactly what was sent, and **Hide contents** to fold it away. Send waits until every file has been read.

## Voice

- **Dictation** — the microphone in the message box writes what you say into the box, after whatever you have already typed. Stop works at any moment.
- **Live voice** — a spoken conversation; choose the voice in chat settings → **Voice**.
- **Read aloud** — on any reply.

## Tools in the + menu

- **Create image** — describe a picture and a free image model draws it. The result says which model made it. You are told plainly when a prompt is too short, was filtered, is too long, or when image creation is not set up.
- **Create music clip** — shown only when a free music model is available.
- **Run code** — lets a model that supports it run code to work something out. When the model you picked cannot run code, the chip says so and the reply is written without it.
- **Saved prompts** — keep prompts you reuse and insert them with one tap.

## Projects, memory and temporary chats

- A **project** groups chats and gives them standing instructions and up to 10 reference files.
- **Memory** is off until you switch it on. You write the lines yourself, and you can edit or remove any of them; the assistant never adds to it.
- A **temporary chat** is never saved to the device.

Chats are kept on your device, at most 50. Chat settings → **Data** exports and imports them.

## Slash commands

Type `/` in the composer to open the menu. Tab completes a command.

| Command | What it does |
|---|---|
| `/playlist <vibe>` | Builds a playlist from a description |
| `/now` | Shows what is playing, with controls |
| `/lyrics` | Explains the lyrics of the song playing now |
| `/mood <mood>` | Plays songs for a mood |
| `/summary` | Summarises the conversation |
| `/think` | Toggles Think |
| `/prompts` | Opens your saved prompts |
| `/export` | Exports the chat |
| `/clear` | Starts a new chat |

## Songs in replies

A line in a reply written as “Title — Artist” becomes a playable card once it is matched in the catalogue. A reply with two or more songs gets **Play all**, **Add to queue** and **Save as playlist**.

You can also control the player by message: “play *song*”, “queue *song*”, “pause”, “resume”, “next” and “previous”.


## When a reply does not arrive

| You see | What it means | What to do |
| --- | --- | --- |
| "You’re offline — reconnect and ask again." | The device has no connection. | Reconnect, then **Retry**. |
| "That was a lot of messages at once — give it a moment, then try again." | Every model is busy. VinaX AI has already asked a second time. | Wait a little, then **Retry**. |
| "The assistant paused — please try again." | A passing fault. | **Retry**. |
| "VinaX AI is switched off right now — the rest of the app works as usual." | The assistant is turned off or not set up. | Nothing to do; music keeps working. |
| "VinaX AI has reached its limit for today — please try again later." | The day's allowance is used up. | Try again later. |
| "That model is no longer available — switched to Auto." | The model you picked was withdrawn. | Ask again; Auto answers. |
| "That picture or file is too large to send — try a smaller one." | The message is over the size limit. | **Edit message** and remove or shrink the attachment. |
| "That message couldn’t be sent as it is — try rewording it or removing an attachment." | The message was refused as written. | **Edit message**. |
| "This answer was cut short — ask me to continue." | The reply stopped early. | Ask it to continue. |
| "No reply — try again" | The page was reloaded while a reply was being written. | **Retry**. |

## What it can and cannot know

VinaX AI has no live web access. It answers from what the model learned, so news, charts and release dates may be out of date, and it is asked to say so. It knows your music taste only as far as the app sends it with a question, and it can use the song playing now only if you switch that on.

## AI Playlist

**AI Playlist** (Discover's shortcuts, or `/playlist` in the chat) turns a description into a playlist of songs from the catalogue. A language you name in the description wins over your saved languages, so “a Telugu workout playlist with high-energy songs” gives Telugu songs even if you listen mostly in Hindi. The list is filled out to 25 songs where enough fit. When the AI curator cannot answer, VinaX still builds a playlist from catalogue searches that match your idea, if it finds at least eight songs, and says so in the playlist's description.

### Keeping the tracks you like

Once a playlist is built, each track has **Keep** and **Replace**:

- **Keep** pins it. **Build it again** then keeps every kept track exactly where it
  is and replaces only the rest.
- **Replace** swaps that one track for something else and leaves the others alone.
  The song you rejected will not come back — not under a different release of it
  either.
- **Build it again** on the same idea really does change the list: VinaX asks the
  catalogue different questions and reads further into it each time.
- **Fewer repeats** builds it leaving out everything you have heard or been shown
  lately. It can give you a shorter list, and says so.
- **Refine** changes the list you are looking at — "more upbeat", "fewer film
  songs" — without starting over. Kept tracks stay put.

You can also ask for a **length**: "15 songs", "about an hour". A count is exact; a
duration is approximate, because VinaX does not know how long each song is until it
finds it — so it says "about". If not enough songs really fit your idea, you get
fewer and a line saying why, rather than a full list padded with near-misses.


## Privacy

VinaX has no accounts. Your chats, projects, memory lines and settings stay on your device. When you send a message, the message, the recent part of the chat, any files or pictures you attached and a short summary of your taste go to the AI provider whose model answers, through VinaX's own server; that is the only way a model can reply. [Data and privacy](../data-and-privacy.md) lists exactly what leaves the device and when.
