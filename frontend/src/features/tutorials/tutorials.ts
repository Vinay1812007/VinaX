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
 *
 * 10.1 — copy brought up to the Marigold + frosted-glass app (the new
 * search, Listen Together, VinaX AI connectors), a Listen Together tour, and
 * every step driven in a real browser at phone and desktop sizes: a target
 * at the top of the screen takes `placement: 'bottom'` (a card placed above
 * it would sit off-screen), and a target further down a long page needs
 * `reveal` (below).
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

/**
 * 10.1 — bring a target that sits below the fold into view before the runner
 * looks for it. The runner only accepts a match that is already on screen (so
 * it can skip the hidden copy of the player bar), which means a control
 * further down a long page — Settings' Discovery and Sound — was never found
 * and its card was centred over nothing.
 */
const reveal = (selector: string) => async (): Promise<void> => {
  await wait(250);
  document.querySelector(selector)?.scrollIntoView({ block: 'center', inline: 'nearest' });
  await wait(150);
};

export const TUTORIALS: Tutorial[] = [
  {
    id: 'first-song',
    title: 'Play your first song',
    blurb: 'Start music, see how the DJ builds the next five, and steer what plays next, or start AI Radio.',
    minutes: 3,
    emoji: '▶️',
    playsMusic: true,
    steps: [
      { route: '/', title: 'Let’s play something', body: 'This walkthrough runs inside the real app and starts a song in your first language.', tip: 'Leave at any time with Esc or Skip.' },
      { route: '/', target: '.vx-topbar', title: 'Where you are', body: 'The top bar holds this page’s actions. Home, Discover, Search, Library and VinaX AI sit in the navigation.', placement: 'bottom' },
      { route: '/', target: '[aria-label="Play your Aura Mix"]', title: 'Your Aura Mix', body: 'This button plays a mix built from your languages and listening. Press Next and the tutorial starts a song for you.', placement: 'bottom' },
      { target: '[data-tour="player"]', title: 'The player bar', body: 'Play, pause and skip from here. Tap the artwork or title for the full-screen player.', action: async () => { await playTutorialSong(); await wait(700); }, placement: 'top' },
      { target: '[data-tour="player"] [aria-label="Add to favorites"], [data-tour="player"] [aria-label="Remove from favorites"]', title: 'Like it', body: 'The heart adds the song to Liked songs and teaches your taste profile, on this device only.', tip: 'A snackbar confirms it, with View.', placement: 'top' },
      { route: '/queue', target: 'section[aria-label="Tune this queue"]', title: 'The next five', body: 'Tap any song and the DJ lines up five more, led by its language, familiar first. A tune chip rebuilds them; the Smart Queue switch below the list turns the DJ on or off.', action: async () => { await wait(400); }, placement: 'bottom' },
      { route: '/now-playing', target: 'button.vx-np-tool[aria-label="Player tools"]', title: 'Full-screen player', body: 'Swipe the artwork left for next, right for previous. This sliders button holds the sleep timer, speed, bookmarks and Tune this queue.', action: async () => { await wait(600); }, placement: 'top' },
      { route: '/now-playing', title: 'Pin a mood', body: 'In the Up Next tab, Pin a mood rebuilds Up Next for that mood and holds it for 45 minutes.' },
      { title: 'Your picks go first', body: 'Songs you add with Play next or Add to queue always play before the DJ’s picks.', tip: 'Space plays and pauses, N skips, F likes.' },
      { title: 'Endless music', body: 'Start AI Radio from any song menu, or from the first tile on Home, and the DJ keeps the music going from a song, a mood or a few words.' },
    ],
  },
  {
    id: 'find-anything',
    title: 'Find any song',
    blurb: 'Suggestions as you type, the Top result first, search by description or lyrics, trending searches and Discover’s shortcuts.',
    minutes: 2,
    emoji: '🔍',
    steps: [
      { route: '/search', target: '[data-tour="search-input"]', title: 'One box for everything', body: 'Type a song, artist, film or mood in any script. Suggestions open under the box as you type.', placement: 'bottom' },
      { route: '/search', target: '[data-tour="search-input"]', title: 'Suggestions as you type', body: 'Completions come first, then songs, artists and albums. Tap a song to play it, or use ↑, ↓ and Enter.', tip: 'Esc closes the suggestions.', placement: 'bottom' },
      { route: '/search', title: 'The Top result first', body: 'Press Enter for full results: the Top result leads, then Songs, Artists, Albums and Playlists, each with See all.' },
      { route: '/search', target: '[data-tour="search-input"]', title: 'Describe it', body: 'Type a description such as “sad telugu songs for rain” and Songs that match lists the songs that fit best.', placement: 'bottom' },
      { route: '/search', target: '[data-tour="search-input"]', title: 'Remember only the words?', body: 'Type five or more words of a lyric and VinaX offers Search by lyrics.', placement: 'bottom' },
      { route: '/search', title: 'Recents and trending', body: 'Long-press or hover a recent search to pin it. Trending searches are chips: tap one to search it.', tip: 'Press ⌘/Ctrl+K anywhere for the command palette.' },
      { route: '/discover', target: 'nav[aria-label="Browse music"] a[href="/charts"]', title: 'Discover’s shortcuts', body: 'Charts, Languages and Moods lead the grid; Regions, Movies, Videos, Made for you, Your week and AI playlist follow.', placement: 'bottom' },
    ],
  },
  {
    id: 'listen-together',
    title: 'Listen Together',
    blurb: 'Host a session or join one with a code, the Live pill, Tap to start listening, and songs for everyone.',
    minutes: 2,
    emoji: '🎧',
    steps: [
      { route: '/together', target: 'section[aria-labelledby="vx-lt-start"] .vx-lt-cta', title: 'Host a session', body: 'Start a session for a room code, a QR and an invite link. Then play as usual, from any page.', placement: 'bottom' },
      { route: '/together', target: '#vx-lt-code', title: 'Join with a code', body: 'Type the code your host shared, or open their invite link. Your player then follows the host’s, in step.', placement: 'bottom' },
      { title: 'The Live pill', body: 'While a session runs, a Live pill sits on every other page. Tap it to come back to the room.' },
      { title: 'Tap to start listening', body: 'If your browser holds back sound, the pill says Tap to start listening. One tap and you are in step.' },
      { title: 'Songs and reactions', body: 'Guests add songs for everyone and the host’s queue plays them. Reactions float on every screen in the room.', tip: 'End for everyone closes the room; Leave session takes only you out.' },
    ],
  },
  {
    id: 'meet-ai',
    title: 'Ask VinaX AI',
    blurb: 'The composer, Connectors in the + menu, the model menu and chat settings.',
    minutes: 2,
    emoji: '✨',
    steps: [
      { route: '/VinaXAI', target: 'textarea[aria-label="Message VinaX AI"]', title: 'The composer', body: 'Ask anything: writing, code, maths, translation or music. Type / for commands such as /playlist, /now, /lyrics and /summary.', placement: 'top' },
      { route: '/VinaXAI', target: 'button[aria-label="Attach and tools"]', title: 'Files and connectors', body: 'The + button uploads files and holds Connectors: Think, Now playing, Memory and Place.', tip: 'The connectors that are on show as chips above the message box.', placement: 'top' },
      { route: '/VinaXAI', target: 'button[aria-label^="Model:"]', title: 'The model menu', body: 'Auto, the default, picks the best model for each question. Below it, search every free model VinaX can reach, under its own name.', placement: 'top' },
      { route: '/VinaXAI', title: 'Songs you can play', body: 'A “Title — Artist” line in a reply becomes a playable card, with Play all and Save as playlist.' },
      { route: '/VinaXAI', target: 'button[aria-label="Chat settings"]', title: 'Chat settings', body: 'Tabs for General, Replies, Voice, Data and Shortcuts: default model, reply language and style, spoken voice, and your chat storage.', placement: 'bottom' },
    ],
  },
  {
    id: 'make-it-yours',
    title: 'Make it yours',
    blurb: 'Settings search, discovery modes, accents, frosted glass, sound and backups.',
    minutes: 2,
    emoji: '🎨',
    steps: [
      { route: '/settings', target: 'input[aria-label="Search settings"]', title: 'Find any setting', body: 'Type “theme”, “sleep” or “quality” and only the matching settings stay.', placement: 'bottom' },
      { route: '/settings', target: '[aria-label="Discovery mode"] [aria-checked="true"]', title: 'Familiar, Balanced or Discover', body: 'Choose how far recommendations roam. Every queue still opens with familiar songs; Queue languages, below, decides if other languages follow.', action: reveal('[aria-label="Discovery mode"]'), placement: 'bottom' },
      { route: '/settings', target: '[aria-label="Festival themes"]', title: 'Festival themes', body: 'On festival days the app takes on a festive look. This switch keeps one look all year.', action: reveal('[aria-label="Festival themes"]'), placement: 'bottom' },
      { route: '/settings', target: '[aria-label="Custom accent colour"]', title: 'Your colour', body: 'Marigold is the default accent, with Copper and eight more beside it. Or pick any colour and VinaX derives the palette.', action: reveal('[aria-label="Custom accent colour"]'), placement: 'bottom' },
      { route: '/settings', target: '[aria-label="Glass effect intensity"]', title: 'Frosted glass', body: 'Glass effect and Background blur set how see-through the bars, menus and sheets are. Slide toward Solid for plainer panels.', action: reveal('[aria-label="Glass effect intensity"]'), placement: 'bottom' },
      { route: '/settings', target: '[data-tour="sound"] .vx-set-head', title: 'Sound', body: 'A five-band equaliser, balance, mono and loudness normalisation, processed on your device. Turn on Sound effects first.', action: reveal('[data-tour="sound"] .vx-set-head'), placement: 'bottom' },
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
      { route: '/library', title: 'Your library', body: 'Liked songs, playlists, saved albums and artists all live on this device.' },
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
