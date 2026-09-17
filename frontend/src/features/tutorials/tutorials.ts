import { searchSongs } from '@/services/api';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';

/**
 * v5.20.0 — live tutorial definitions. Every step names a real control
 * (CSS selector) that the runner spotlights, and may run an `action` first
 * (navigate, start a song, open a panel). Copy rule: every claim must be
 * true today; short lines; the listener is a tap away from music.
 *
 * v7.1 rewrite — a step is a title of at most 6 words and a body of at most
 * 22 words. A target must exist in the current source and must be a short
 * element (the card sits above or below it); when the control only appears
 * after a tap (a menu, a tab), leave `target` out and the card is centred.
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
    blurb: 'Start music, see how the DJ builds the next five, and steer what plays next.',
    minutes: 3,
    emoji: '▶️',
    playsMusic: true,
    steps: [
      { route: '/', title: 'Let’s play something', body: 'This walkthrough runs inside the real app and starts a song in your first language.', tip: 'Leave at any time with Esc or Skip.' },
      { route: '/', target: '.vx-topbar', title: 'Where you are', body: 'The top bar names the page and holds its actions. Home, Discover, Search, Library and VinaX AI sit in the navigation.', placement: 'bottom' },
      { route: '/', target: '[aria-label="Play your Aura Mix"]', title: 'Play my mix', body: 'A mix built from your languages and listening. Press Next and the tutorial starts a song for you.', placement: 'bottom' },
      { target: '[data-tour="player"]', title: 'The player bar', body: 'Play, pause and skip from here. Tap the artwork or title for the full-screen player.', action: async () => { await playTutorialSong(); await wait(700); }, placement: 'top' },
      { target: '[data-tour="player"] [aria-label="Add to favorites"], [data-tour="player"] [aria-label="Remove from favorites"]', title: 'Like it', body: 'The heart saves the song to your favourites and teaches your taste profile, on this device only.', placement: 'top' },
      { route: '/queue', target: 'section[aria-label="Tune this queue"]', title: 'The next five', body: 'Tap any song and the DJ lines up five more in its language, familiar first. A tune chip rebuilds them.', action: async () => { await wait(400); }, placement: 'bottom' },
      { route: '/now-playing', target: '[aria-label="More options"]', title: 'Full-screen player', body: 'Flick the artwork up or down to change song. More options holds the sleep timer, speed, bookmarks and Tune this queue.', action: async () => { await wait(600); }, placement: 'top' },
      { route: '/now-playing', title: 'Pin a mood', body: 'In the Up Next tab, Pin a mood rebuilds Up Next for that mood and holds it for 45 minutes.' },
      { title: 'Your picks go first', body: 'Songs you add with Play next or Add to queue always play before the DJ’s picks.', tip: 'Space plays and pauses, N skips, F likes.' },
    ],
  },
  {
    id: 'find-anything',
    title: 'Find any song',
    blurb: 'Search as you type, lyrics search, sorting, recents and Discover’s shortcuts.',
    minutes: 2,
    emoji: '🔍',
    steps: [
      { route: '/search', target: '[data-tour="search-input"]', title: 'One box for everything', body: 'Type a song, artist, film or mood in any script. Results appear as you type; Enter opens every tab.', placement: 'bottom' },
      { route: '/search', target: '[data-tour="search-input"]', title: 'Remember only the words?', body: 'Type five or more words of a lyric and VinaX offers Search by lyrics.', placement: 'bottom' },
      { route: '/search', title: 'Sort and play all', body: 'On the Songs tab, sort by relevance, popularity, newest, length or A to Z, then Play all or Queue all.' },
      { route: '/search', title: 'Recents and trending', body: 'Long-press or hover a recent search to pin it. Trending searches show what listeners look for now.', tip: 'Press ⌘/Ctrl+K anywhere for the command palette.' },
      { route: '/discover', target: 'nav[aria-label="Browse music"]', title: 'Discover’s shortcuts', body: 'Charts, Languages, Moods, Regions, Movies, Videos, Made For You, Your Week, AI Playlist and Ads, one tap each.', placement: 'bottom' },
    ],
  },
  {
    id: 'meet-ai',
    title: 'Ask VinaX AI',
    blurb: 'The composer, the model menu, Agent mode, slash commands and chat settings.',
    minutes: 2,
    emoji: '✨',
    steps: [
      { route: '/VinaXAI', target: 'textarea[aria-label="Message VinaX AI"]', title: 'The composer', body: 'Ask anything: writing, code, maths, translation or music. Type / for commands such as /playlist, /now, /lyrics and /summary.', placement: 'top' },
      { route: '/VinaXAI', target: 'button[aria-label="Attach and tools"]', title: 'Attach and tools', body: 'The + button uploads files or a folder and switches on Web search, Think, Research or image creation.', placement: 'top' },
      { route: '/VinaXAI', target: 'button[aria-label^="Model:"]', title: 'The model menu', body: 'Search every model VinaX can reach. Recent and recommended ones come first; Auto picks an engine for each question.', placement: 'top' },
      { route: '/VinaXAI', target: 'button[aria-label="Agent mode"]', title: 'Agent mode', body: 'When on, an agent-capable model can search the web and run code by itself. It is greyed out when none is available.', placement: 'top' },
      { route: '/VinaXAI', title: 'Songs you can play', body: 'A “Title — Artist” line in a reply becomes a playable card, with Play all and Save as playlist.' },
      { route: '/VinaXAI', target: 'button[aria-label="Chat settings"]', title: 'Chat settings', body: 'Tabs for General, Replies, Voice, Data and Shortcuts: default model, reply language and style, spoken voice, and your chat storage.', placement: 'bottom' },
    ],
  },
  {
    id: 'make-it-yours',
    title: 'Make it yours',
    blurb: 'Settings search, discovery modes, themes, sound and backups.',
    minutes: 2,
    emoji: '🎨',
    steps: [
      { route: '/settings', target: 'input[aria-label="Search settings"]', title: 'Find any setting', body: 'Type “theme”, “sleep” or “quality” and only the matching settings stay.', placement: 'bottom' },
      { route: '/settings', target: '[aria-label="Discovery mode"]', title: 'Familiar, Balanced or Discover', body: 'Choose how far recommendations roam. Every queue still opens with familiar songs and stays in its song’s language.', placement: 'top' },
      { route: '/settings', target: '[aria-label="Festival themes"]', title: 'Festival themes', body: 'On festival days the app takes on a festive look. This switch keeps one look all year.', placement: 'bottom' },
      { route: '/settings', target: '[aria-label="Custom accent colour"]', title: 'Your colour', body: 'Pick any colour and VinaX derives the palette from it. The theme choices sit just above.', placement: 'bottom' },
      { route: '/settings', target: '[data-tour="sound"]', title: 'Sound', body: 'A five-band equaliser, balance, mono and loudness normalisation, processed on your device. Turn on Sound effects first.', placement: 'top' },
      { route: '/settings', title: 'Back up and restore', body: 'Your Data exports a backup file. Backup Center previews a restore, merges or replaces, and offers Undo.' },
    ],
  },
  {
    id: 'save-organise',
    title: 'Save and organise',
    blurb: 'Collection shortcuts, import from text, Listen Later and tidy playlists.',
    minutes: 2,
    emoji: '📚',
    steps: [
      { route: '/library', title: 'Your library', body: 'Favourites, playlists, saved albums and artists all live on this device.' },
      { route: '/library', target: 'nav[aria-label="Your collection shortcuts"]', title: 'Collection shortcuts', body: 'Favorites, Listen Later, Downloads, History, Your VinaX and Taste Profile open from here.', placement: 'bottom' },
      { route: '/library', target: '[data-tour="import-text"]', title: 'Import from text', body: 'Paste one song per line as “Title — Artist”. You review every match before the playlist is saved.', placement: 'bottom' },
      { route: '/library', title: 'Queue or save with a swipe', body: 'On touch screens, swipe a song row right to queue it, left for Listen Later. Song menus offer both too.' },
      { route: '/library', title: 'Playlists that stay tidy', body: 'Pin, tag, sort and de-duplicate playlists. A deleted playlist waits in Recently deleted for seven days.', tip: 'Open any song menu for “Your history with this song”.' },
    ],
  },
];

export function tutorialById(id: string | null | undefined): Tutorial | null {
  return id ? TUTORIALS.find((t) => t.id === id) ?? null : null;
}
