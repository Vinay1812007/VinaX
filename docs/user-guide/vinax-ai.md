# VinaX AI

This page covers the VinaX AI destination: what the chat can do, the model menu, Agent mode, slash commands, songs you can play from a reply, controlling the player by message, chat settings, and what is sent to the AI service. The engineering description is in [ai](../ai.md).

## The chat

Open **VinaX AI** from the dock or sidebar. The composer takes any question: writing, code, maths, translation, or music.

| Control | What it does |
|---|---|
| **+** (Attach and tools) | Upload files or a folder, and switch on Web search, Think, Research or image creation. Saved prompts open from the same menu. Files stay on your device until you send. |
| Agent | Turns Agent mode on or off (see below) |
| Model button | Opens the model menu |
| Live voice chat / Voice input | Talk hands-free, or dictate a message, when the device supports speech |
| Send / Stop | Send the message, or stop a reply that is being written (`Esc` also stops) |

| Tool | What it does |
|---|---|
| Web search | Lets the reply use current web results |
| Think | Sends the message to a slower, more careful engine |
| Research | Searches the web and cross-checks more than one source |

Chats are kept on this device. The chat list lets you search, rename, pin and delete chats; the header exports the current chat. `Ctrl/⌘ + K` starts a new chat and `Ctrl/⌘ + B` shows or hides the chat list.

## The model menu

The model button in the composer opens one menu with a search field over every model VinaX can reach. Recently used models come first, then the recommended ones, then the built-in VinaX engines, then one section for each live catalogue with every model in it. **Auto** picks an engine for each question. Arrow keys move, Enter picks, Esc closes.

**Chat settings → General → Default model** sets what a new chat starts with.

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

## What is sent

To answer, the AI service receives the messages in the chat, anything you attached, and, when relevant, a short taste summary or the song that is playing. Your library, history and playlists are not uploaded. If the AI service cannot answer, the chat shows an error; music playback and on-device recommendations keep working. See [data and privacy](../data-and-privacy.md).
