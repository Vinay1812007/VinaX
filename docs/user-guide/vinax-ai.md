# VinaX AI

This page covers the VinaX AI destination: what the chat can do, the model menu, Agent mode, slash commands, songs you can play from a reply, controlling the player by message, chat settings, when a reply does not arrive, AI Playlist, and what is sent to the AI service. The engineering description is in [ai](../ai.md).

## The chat

Open **VinaX AI** from the dock or sidebar. The composer takes any question: writing, code, maths, translation, or music.

| Control | What it does |
|---|---|
| **+** (Attach and tools) | Upload files or a folder, and switch on Web search, Think or Research. Saved prompts open from the same menu. Files stay on your device until you send. |
| Agent | Turns Agent mode on or off (see below) |
| Model button | Opens the model menu |
| Live voice chat / Voice input | Talk hands-free, or dictate a message, when the device supports speech |
| Send / Stop | Send the message, or stop a reply that is being written (`Esc` also stops) |

| Tool | What it does |
|---|---|
| Web search | Lets the reply use current web results. When VinaX Maestro answers, it searches the web itself and the reply lists the pages it used under **Sources**. |
| Think | Sends the message to a slower, more careful engine |
| Research | Searches the web and cross-checks more than one source |

Chats are kept on this device. The chat list lets you search, rename, pin and delete chats; the header exports the current chat. `Ctrl/⌘ + K` starts a new chat and `Ctrl/⌘ + B` shows or hides the chat list.

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

## What is sent

To answer, the AI service receives the messages in the chat, anything you attached, and, when relevant, a short taste summary or the song that is playing. Your library, history and playlists are not uploaded. If the AI service cannot answer, the chat says so (see [When a reply does not arrive](#when-a-reply-does-not-arrive)); music playback and on-device recommendations keep working. See [data and privacy](../data-and-privacy.md).
