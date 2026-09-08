import { searchSongs } from '@/services/api';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';

/**
 * v5.20.0 — live tutorial definitions. Every step names a real control
 * (CSS selector) that the runner spotlights, and may run an `action` first
 * (navigate, start a song, open a panel). Copy rule: every claim must be
 * true today; short lines; the listener is a tap away from music.
 */
export interface TutorialStep {
  title: string;
  body: string;
  /** Spotlight target. Optional: a centred card when absent. */
  target?: string;
  /** Route to be on before this step shows. */
  route?: string;
  /** Runs before the target is looked up (may start music, open a panel). */
  action?: () => Promise<void> | void;
  /** Where the card sits relative to the target. */
  placement?: 'top' | 'bottom';
  /** A tip line shown in smaller type. */
  tip?: string;
}

export interface Tutorial {
  id: string;
  title: string;
  blurb: string;
  minutes: number;
  emoji: string;
  /** True when the walkthrough starts real playback. */
  playsMusic?: boolean;
  steps: TutorialStep[];
}

const langOf = (): string => useSettingsStore.getState().pinnedLanguages[0] ?? 'telugu';
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Starts a real song for the walkthrough (the listener's first language, top hits). */
export async function playTutorialSong(): Promise<boolean> {
  const p = usePlayerStore.getState();
  if (p.queue.length && p.isPlaying) return true;
  try {
    const songs = await searchSongs(`${cap(langOf())} hits`, 12);
    if (!songs.length) throw new Error('empty');
    p.playQueue(songs, 0);
    return true;
  } catch {
    toast('Could not start a song right now — the tutorial continues');
    return false;
  }
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export const TUTORIALS: Tutorial[] = [
  {
    id: 'first-song',
    title: 'Play your first song',
    blurb: 'Start music, meet the player, like a song, open the full screen.',
    minutes: 2,
    emoji: '▶️',
    playsMusic: true,
    steps: [
      { route: '/', title: 'Welcome — let’s play something', body: 'This walkthrough runs inside the real app. It will start a song in your first language so you can hear what every control does.', tip: 'You can stop at any time with Esc or Skip.' },
      { route: '/', target: '[aria-label="Play your Aura Mix"]', title: 'Your Aura Mix', body: 'This button plays a mix tuned to your taste, mood and languages. The AI DJ keeps the queue going after it. Press Next and the tutorial starts a song for you.', placement: 'bottom' },
      { target: '[data-tour="player"]', title: 'The player bar', body: 'Now playing lives here: play/pause, next, previous, shuffle and repeat, plus the seek bar. Tap the artwork or title for the full-screen player.', action: async () => { await playTutorialSong(); await wait(700); }, placement: 'top' },
      { target: '[data-tour="player"] [aria-label="Add to favorites"], [data-tour="player"] [aria-label="Remove from favorites"]', title: 'Like it', body: 'The heart saves a song to Liked Songs and teaches your taste profile — on this device only. Try it now; you can unlike it any time.', placement: 'top' },
      { route: '/now-playing', target: '[aria-label="More options"]', title: 'Full-screen player', body: 'Flick the artwork up for the next song, down for the previous one. Double-tap the edges to seek. More options holds the sleep timer, A-B repeat, bookmarks, playback speed and “Share this moment”.', action: async () => { await wait(600); }, placement: 'top' },
      { title: 'That’s the player', body: 'Synced lyrics follow the singer line by line, and the Queue page shows why each next song was picked. Keep the song playing — or try another tutorial.', tip: 'Space plays and pauses, N skips, F likes.' },
    ],
  },
  {
    id: 'find-anything',
    title: 'Find any song',
    blurb: 'Search as you type, lyrics search, sorting and the recents row.',
    minutes: 2,
    emoji: '🔍',
    steps: [
      { route: '/search', target: '[data-tour="search-input"]', title: 'One box for everything', body: 'Type a song, artist, film or mood — in any language or script. Results appear as you type; Enter opens the full results with tabs for songs, albums, artists and playlists.', placement: 'bottom' },
      { route: '/search', target: '[data-tour="search-input"]', title: 'Remember only the words?', body: 'Paste a lyric line you remember. When a query is five words or longer, VinaX offers Search by lyrics; it matches the line and falls back to song titles when the lyrics service has no hit.', placement: 'bottom' },
      { route: '/search', title: 'Sort, filter, play all', body: 'On the Songs tab, sort by relevance, popularity, newest, length or A→Z, filter within long result lists, and press Play all or Queue all. Language chips narrow results to what you understand.' },
      { route: '/search', title: 'Recents and trending', body: 'Recent searches sit under the box: hover (or long-press) one to pin or remove it. Trending chips show what the community is searching for right now.', tip: 'Press ⌘/Ctrl+K anywhere for the command palette: pages, player actions and songs in one place.' },
    ],
  },
  {
    id: 'meet-ai',
    title: 'Ask VinaX AI',
    blurb: 'The composer, slash commands, reply language and style, follow-ups.',
    minutes: 3,
    emoji: '✨',
    steps: [
      { route: '/VinaXAI', target: 'textarea[aria-label="Message VinaX AI"]', title: 'The composer', body: 'Ask anything — writing, code, maths, research, translation, or music. Attach a photo or file with +, switch on the globe for live web answers, or tap the waveform for hands-free voice chat.', placement: 'top' },
      { route: '/VinaXAI', target: 'textarea[aria-label="Message VinaX AI"]', title: 'Slash commands', body: 'Type / to open the command menu: /playlist <vibe> builds a playlist right here, /now shows what is playing, /lyrics explains the current song, /summary recaps the chat. Tab completes.', placement: 'top' },
      { route: '/VinaXAI', target: 'select[aria-label="Reply language"]', title: 'Reply in your language', body: 'Choose Telugu, Hindi, Tamil, Tenglish, Hinglish and more, and a style — Brief, Detailed, Simple, Steps or Table. Both are remembered for this chat.', placement: 'top' },
      { route: '/VinaXAI', title: 'Songs you can play', body: 'Any “Title — Artist” line in a reply becomes a playable card, with Play all, Queue all and Save as playlist. “Now playing on” lets the assistant see the song you are listening to, so “who composed this?” just works.', tip: 'Think reasons harder; Research checks the live web and cites sources.' },
      { route: '/VinaXAI', title: 'After every answer', body: 'Follow-up chips suggest the next question. Shorten, Expand or Simplify any reply, Listen reads it aloud, Pin keeps it at the top, Branch continues from that point in a new chat.' },
    ],
  },
  {
    id: 'make-it-yours',
    title: 'Make it yours',
    blurb: 'Themes, custom accent, festival looks, sound and the settings search.',
    minutes: 2,
    emoji: '🎨',
    steps: [
      { route: '/settings', target: 'input[aria-label="Search settings"]', title: 'Find any setting', body: 'Type “theme”, “sleep”, “alarm” or “quality” and only the matching settings stay, highlighted.', placement: 'bottom' },
      { route: '/settings', target: '[aria-label="Festival themes"]', title: 'Festival themes', body: 'On 43 festivals — Sankranti to Diwali to Christmas — the whole app takes on its own look: colours, glow, a greeting and a living backdrop. This switch turns that off if you prefer one look all year.', placement: 'bottom' },
      { route: '/settings', target: '[aria-label="Custom accent colour"]', title: 'Your colour', body: 'Pick any colour and VinaX derives the whole palette, with a readable version for the light theme. Dark, Light, Black, System and Auto (day/night) themes sit just above.', placement: 'bottom' },
      { route: '/settings', target: '[data-tour="sound"]', title: 'Sound', body: 'A five-band equaliser with presets, left/right balance, mono audio and loudness normalisation — processed on your device. Turn on Sound effects to start.', placement: 'top' },
      { route: '/settings', title: 'And the rest', body: 'Display size, High contrast, Data saver, a startup page, home layout, a wake-up alarm that plays a playlist, and Your Data for export, import and a clean erase.' },
    ],
  },
  {
    id: 'save-organise',
    title: 'Save and organise',
    blurb: 'Listen Later, playlists, tags, import from text, history.',
    minutes: 2,
    emoji: '📚',
    steps: [
      { route: '/library', title: 'Your library', body: 'Everything here lives on this device: Liked Songs, playlists, saved albums and artists, and recently added songs.' },
      { route: '/library', target: '[data-tour="import-text"]', title: 'Import a playlist from text', body: 'Paste any list — one song per line as “Title — Artist” — and VinaX finds every song and saves a playlist. Copy as text on any playlist does the reverse.', placement: 'bottom' },
      { route: '/library', target: 'a[aria-label="Listen Later"]', title: 'Listen Later', body: 'A one-tap “come back to this” list. Choose Listen later in any song menu, or swipe a song row to the left. Swipe right adds it to the queue.', placement: 'bottom' },
      { route: '/library', title: 'Playlists that stay tidy', body: 'Pin favourites to the top, add tags and filter by them, sort or shuffle-play, remove duplicates, and restore anything deleted within seven days.', tip: 'Open any song menu for “Your history with this song”.' },
    ],
  },
];

export function tutorialById(id: string | null | undefined): Tutorial | null {
  return id ? TUTORIALS.find((t) => t.id === id) ?? null : null;
}
