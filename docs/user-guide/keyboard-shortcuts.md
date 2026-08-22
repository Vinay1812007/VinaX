# Keyboard shortcuts

*Last updated: v3.8. Desktop web only — keyboard shortcuts are
suppressed inside the Android app since hardware keyboards there are
rare and would surprise touch users.*

All shortcuts are suppressed while you're typing in a text field or a
`contenteditable` region — so pressing Space in the search bar types
a space, it doesn't pause playback.

Modifier-combo shortcuts (Cmd/Ctrl+F, Cmd/Ctrl+P, Cmd/Ctrl+S,
Cmd/Ctrl+R, Alt+…) are **always** let through to the browser. VinaX
never grabs those — so browser Find, Print, Save, Reload behave
exactly as normal.

---

## Playback

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `→` | Seek forward 10 s |
| `←` | Seek back 10 s |
| `↑` | Volume up (5%) |
| `↓` | Volume down (5%) |
| `n` | Next track |
| `p` | Previous track |
| `m` | Mute / unmute |
| `s` | Toggle shuffle |
| `r` | Cycle repeat off → all → one → off |
| `f` | Favorite / unfavorite the current track |

---

## Navigation

| Key | Action |
|---|---|
| `Cmd/Ctrl + K` | Open the command palette |
| `Cmd/Ctrl + /` | Same — command palette |
| `Tab` | Move focus to the next control |
| `Shift + Tab` | Move focus to the previous control |
| `Esc` | Close open sheet / modal / dialog / menu |

The command palette (`Cmd/Ctrl+K`) is the fastest way to jump
anywhere: type "settings", "queue", "favorites", "song: <name>",
"artist: <name>", etc. Enter to go, Esc to cancel.

---

## Focus

VinaX shows a **visible focus ring** whenever you tab through the
app, and never on a mouse click. If you can see it, you can act on
it with `Enter` or `Space`. If you can't see it, click into the page
first — the browser sometimes forgets to hand focus to VinaX on a
freshly-opened tab.

The `:focus-visible` treatment is a 2 px indigo ring at
`rgba(138,103,255,.65)` with a 5 px halo. It respects your
`prefers-reduced-motion` setting.

---

## TV / D-pad (not a keyboard, but the same code path)

When VinaX detects it's running on an Android TV, D-pad Left/Right/
Up/Down move focus between focusable controls with a *bigger* accent
ring (4 px, 7 px halo) and — unless the user has asked for reduced
motion — a subtle 1.04× scale on the focused control. Enter/Center
activates.

---

## Turning shortcuts off

There isn't a toggle. Shortcuts are additive — none of them are
destructive, none of them commit paid-for actions, all of them are
undoable, and none of them collide with browser shortcuts. If a
specific one is causing you trouble, please open an issue on GitHub
with the key and the surprise you hit.

---

## Requesting a new shortcut

Open an issue on GitHub with:

- The key or key-combo you'd like to bind
- The action it should trigger (in one sentence)
- Whether it should fire while typing (default: no)

The bar for adding a new one is: **it doesn't collide with anything
common, it's undoable, and the action is obvious enough that the
key would guess itself.**
