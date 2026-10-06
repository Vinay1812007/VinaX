# VinaX AI

This page covers the VinaX AI destination: what the chat can do, the connectors in the + menu, the tool timeline, web search and where it looks, the model menu, Agent mode, slash commands, songs you can play from a reply, controlling the player by message, chat settings, when a reply does not arrive, AI Playlist, and what is sent to the AI service. The engineering description is in [ai](../ai.md).

## The chat

Open **VinaX AI** from the tab bar or sidebar. The composer takes any question: writing, code, maths, translation, or music.

| Control | What it does |
|---|---|
| **+** (Attach and tools) | Upload files or a folder, and switch the **connectors** on or off (below). Saved prompts open from the same menu. Files stay on your device until you send. |
| Agent | Turns Agent mode on or off (see below) |
| Model button | Opens the model menu |
| Live voice chat / Voice input | Talk hands-free, or dictate a message, when the device supports speech |
| Send / Stop | Send the message, or stop a reply that is being written (`Esc` also stops) |

### Connectors

The + menu lists the **connectors**: what a reply may draw on. Each row says in one line what it does or what it shares. The ones that are on show as chips above the message box; tap a chip's × to turn it off.

| Connector | What it does |
|---|---|
| Web search | Lets the reply use current web results (see [Where web search looks](#where-web-search-looks)). The reply lists the pages it used under **Sources**. |
| Research | Searches the web and cross-checks more than one source. Turns Web search on too. |
| Think | Sends the message to a slower, more careful engine |
| Now playing | Sends the song playing now — its title, artist, album, year, language and its first lyric lines — with your message, so you can ask about it |
| Memory | The lines you asked VinaX AI to remember (see below). Switching it off forgets them, so with lines saved it asks for a second tap |
| Place | Your coarse place and time zone, for local dates and times. It is greyed out when region sharing is off in Settings, and switching it off here keeps it out of your chats only |

### Watching it work

When a reply searches the web, reads a page or runs code, each step appears as it happens — "Searching the web for …", "Reading example.com" — with a spinner, then a check. Once the answer starts, the steps fold into one line such as **Searched the web · 5 sources** or **Used 3 tools**; tap it to open them again. Nothing in the list is made up: a step shows only when the engine really took it.

While VinaX AI is thinking, its mark breathes gently and new text fades in, with a small spark where the reply is being written. All of it holds still when reduced motion is on.

### Where web search looks

When **VinaX Maestro** answers with Web search on, it uses its own engine's live search. Otherwise VinaX searches several sources at the same time and keeps only results that are actually about your question:

- the open web, through VinaX's own search service, which passes your search words on to public search engines;
- a keyed web search service, when the owner has set one up;
- a public online encyclopedia, which knows who an artist is or what a film is even when the open web is slow.

The searching is done by VinaX's server, so these sources see only the search words — never your name, your device or your library. The search words are your question; a short follow-up such as "what about his new movie?" also carries the topic of your previous question, so it is searched in context. VinaX AI can also decide by itself that a question needs current information and search; the steps and the **Sources** then show it. If no source finds anything relevant, the reply says it could not check the live web instead of guessing.

Switching on Web search or Research also wakes VinaX's search service in advance, so your first question is answered faster.

Chats are kept on this device. The chat list lets you search, rename, pin and delete chats; the header exports the current chat. `Ctrl/⌘ + K` starts a new chat and `Ctrl/⌘ + B` shows or hides the chat list.

### Artifacts

When a reply writes something whole — a page, a document, a block of code — it
also lands in the **Artifacts** panel, from the button in the header. Each one is
listed once with **every version kept**, so "make that shorter" three times leaves
you four versions you can go back to. Copy it, download it, jump to where it was
written, and for a page or a drawing, see it running.

A preview runs **sealed off from VinaX**: it cannot read your chats, your library,
your settings or anything else on the device.

### Projects

A **project** is a group of chats that share standing instructions and reference
files. Set it up once — "you are helping me write liner notes; here is the track
list" — and every chat in the project starts there instead of you explaining it
again. Open **Projects** in the sidebar to make one, write its instructions,
attach files, and put the current chat in it. It all stays on this device.

### Things VinaX AI remembers

In **Settings → Replies** you can switch on **Let VinaX AI remember things** and
write lines you would otherwise repeat — "I play the veena, keep examples
practical". They travel with every chat. You can edit any line, delete any line,
and switching the feature off **forgets all of them**. VinaX AI never adds a line
by itself.

### Temporary chat

**Temporary chat** in the sidebar starts a chat that is never written to this
device: it is gone when you close the tab, it never appears in your chat list
again, and it is not part of an export.

### Editing what you asked

Editing one of your own messages puts it back in the box so you can change it.
The conversation as it was — including the answers that followed — is kept as its
own chat named “… · before edit”, so nothing you may want back is thrown away.

### Very long chats

A long conversation eventually outgrows what any engine can read at once. VinaX AI
keeps the recent part word for word and carries the earlier **questions** along as
a short list. It will tell you plainly that it no longer has the text of an older
answer rather than inventing one, so if you need an old answer, paste the part
that matters.

### Where you are

If you allow it (**Settings → Region & privacy → Allow region inference**), VinaX AI knows
roughly where you are: your country, your state, an approximate city and your time
zone. That is what makes “what is on this evening” and “this week's releases”
answer for *your* clock instead of India's, and it shapes how searches are worded.

It is coarse on purpose and never an address. It is never used to guess what
language you want — your language settings decide that. Switch the setting off and
nothing about your location is sent at all.

### Attaching files

Images, text and code files, and **PDFs** — VinaX reads a PDF's text and attaches
that. Where a PDF cannot be read — it is a scan, it is password-protected, or its
text is stored in a way that cannot be decoded — VinaX tells you which file and
why, rather than quietly leaving it out. While files are being read you can see
which one is in progress and press **Stop**; anything already read stays attached.

Long files are trimmed to fit the message, and VinaX says when it trimmed one.

## The model menu

The model button in the composer opens one menu with a search field over every model VinaX can reach. Recently used models come first, then the recommended ones (Auto, VinaX Maestro, Balanced, Fast, Deep, Creative, Translate), then the other VinaX engines, then one section for each live catalogue with every model in it. Arrow keys move, Enter picks, Esc closes.

**Auto** answers with VinaX Maestro whenever that engine is available and not resting after a recent failure, and otherwise picks an engine from the shape of the question. **VinaX Maestro** is the flagship engine: its replies stream as they are written, and with Web search on it uses its own live search and lists its sources. The chip under a reply names the engine that actually answered.

A chat opens on your default model, else the model you used last, else Auto. **Chat settings → General → Default model** sets the default.

## Agent mode

With Agent mode on, VinaX uses an agent-capable model that can search the web and run code by itself, and the chat shows what the agent is doing. While it is on, the model menu lists agent-capable models only. The Agent button is greyed out when no agent model is available. **Chat settings → General → Start in Agent mode** opens the chat with it on.

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
| `/web` | Toggles web search |
| `/prompts` | Opens your saved prompts |
| `/export` | Exports the chat |
| `/clear` | Starts a new chat |

## Songs in replies

A line in a reply written as “Title — Artist” becomes a playable card once it is matched in the catalogue. A reply with two or more songs gets **Play all**, **Add to queue** and **Save as playlist**.

You can also control the player by message: “play *song*”, “queue *song*”, “pause”, “resume”, “next” and “previous”.

## Chat settings

The gear in the chat header opens a dialog with five tabs.

| Tab | What is there |
|---|---|
| General | Text size, default model, Send with Enter, Start in Agent mode |
| Replies | Reply language, reply style, and an optional “About you” note. The note stays on this device and is sent with each message so replies fit you. |
| Voice | The voice for spoken replies, a preview, and reading replies aloud automatically |
| Data | Storage used, export all chats, import chats, clear all chats (with a short Undo) |
| Shortcuts | The chat's keyboard shortcuts |

Saved prompts and reply preferences are included in a backup; see [Library and backup](library-and-backup.md).

## When a reply does not arrive

If an engine fails or runs out of allowance, VinaX moves to another one by itself, and the chip under the reply names the engine that answered. If no reply starts at all because the service was briefly busy, VinaX asks once more by itself after a moment. If that fails too, the reply says so and offers **Retry**, which asks the same question again.

Two answers are not worth retrying, so they have no Retry: “VinaX AI is switched off right now” and “VinaX AI has reached its limit for today”. The rest of the app works as usual either way.

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

## What is sent

To answer, the AI service receives the messages in the chat, anything you attached, and, when relevant, a short taste summary, your coarse region if you allow it and the Place connector is on, your memory lines if Memory is on, or the song that is playing if Now playing is on. A web search sends only the search words, from VinaX's server, to the sources listed in [Where web search looks](#where-web-search-looks). Your library, history and playlists are not uploaded. If the AI service cannot answer, the chat says so (see [When a reply does not arrive](#when-a-reply-does-not-arrive)); music playback and on-device recommendations keep working. See [data and privacy](../data-and-privacy.md).
