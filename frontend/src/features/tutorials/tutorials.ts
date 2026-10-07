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
 *
 * 11.0 rewrite — every tour re-walked against the six app styles; a title is
 * at most 5 words and a body one or two sentences. New tours: the app's look,
 * festival themes, and VinaX AI models and chat styles. A step whose anchor
 * is missing is skipped by the runner, and tutorials.test.ts fails when a
 * `data-tour` id or an aria-label a selector names is no longer in the source.
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
  /** Runs when the step is left in any direction (closes what `action` opened). */
  leave?: () => void;
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

const click = (selector: string) => async (): Promise<void> => {
  await wait(250);
  document.querySelector<HTMLElement>(selector)?.click();
  await wait(350);
};

const PLAYER = '[data-tour="player"]';
const SEARCH = '[data-tour="search-input"]';

export const TUTORIALS: Tutorial[] = [
  {
    id: 'first-song',
    title: 'Play your first song',
    blurb: 'Start a song, see how the next five are chosen, and steer what plays after it.',
    minutes: 2,
    emoji: '▶️',
    playsMusic: true,
    steps: [
      { route: '/', title: 'A tour that plays', body: 'This tour runs inside the app and starts a song in your first language.', tip: 'Leave at any time with Esc or Close.' },
      { route: '/', target: '.vx-topbar', title: 'Where you are', body: 'The top bar holds this page’s actions. Home, Discover, Search, Library and VinaX AI sit in the navigation.', placement: 'bottom' },
      { route: '/', target: '[aria-label="Play your Aura Mix"]', title: 'Your Aura Mix', body: 'This button plays a mix built from your languages and listening. Press Next and the tour starts a song.', placement: 'bottom' },
      { target: PLAYER, title: 'The player bar', body: 'Play, pause and skip from here. Tap the artwork or title for the full-screen player.', action: async () => { await playTutorialSong(); await wait(700); }, placement: 'top' },
      { target: `${PLAYER} [aria-label="Add to favorites"], ${PLAYER} [aria-label="Remove from favorites"]`, title: 'Like a song', body: 'The heart adds the song to Liked songs. Your likes shape Home, on this device only.', placement: 'top' },
      { route: '/queue', target: 'section[aria-label="Tune this queue"]', title: 'The next five', body: 'After any song, VinaX lines up five more, led by its language. A chip here rebuilds them.', action: () => wait(400), placement: 'bottom' },
      { route: '/now-playing', target: 'button.vx-np-tool[aria-label="Player tools"]', title: 'Player tools', body: 'This button holds the sleep timer, speed, bookmarks and Tune this queue. Swipe the artwork to skip.', action: () => wait(600), placement: 'top' },
      { title: 'Your picks play first', body: 'Songs you add with Play next or Add to queue play before the ones VinaX chose.', tip: 'Space plays and pauses, N skips, F likes.' },
    ],
  },
  {
    id: 'find-anything',
    title: 'Find any song',
    blurb: 'Suggestions as you type, the top result, search by description or lyrics, and Discover.',
    minutes: 2,
    emoji: '🔍',
    steps: [
      { route: '/search', target: SEARCH, title: 'One search box', body: 'Type a song, artist, film or mood in any script. Suggestions open under the box as you type.', placement: 'bottom' },
      { route: '/search', target: SEARCH, title: 'Full results', body: 'Press Enter for the Top result, then Songs, Artists, Albums and Playlists, each with See all.', tip: 'Use ↑, ↓ and Enter in the suggestions. Esc closes them.', placement: 'bottom' },
      { route: '/search', target: SEARCH, title: 'Describe a song', body: 'Type a description such as “sad telugu songs for rain” and Songs that match lists the closest songs.', placement: 'bottom' },
      { route: '/search', target: SEARCH, title: 'Search by lyrics', body: 'Type five or more words of a lyric and VinaX offers Search by lyrics.', placement: 'bottom' },
      { route: '/search', title: 'Recent and trending', body: 'Long-press or hover a recent search to pin it. Tap a trending chip to search it.', tip: 'Press ⌘/Ctrl+K anywhere for the command palette.' },
      { route: '/discover', target: 'nav[aria-label="Browse music"] a[href="/charts"]', title: 'Discover', body: 'Charts, Languages and Moods lead this grid. Regions, Movies, Videos and mixes follow.', placement: 'bottom' },
    ],
  },
  {
    id: 'listen-together',
    title: 'Listen Together',
    blurb: 'Host a session or join with a code, and play the same song on every phone.',
    minutes: 2,
    emoji: '🎧',
    steps: [
      { route: '/together', target: 'section[aria-labelledby="vx-lt-start"] .vx-lt-cta', title: 'Host a session', body: 'Start a session to get a room code, a QR and an invite link. Then play as usual, from any page.', placement: 'bottom' },
      { route: '/together', target: '#vx-lt-code', title: 'Join with a code', body: 'Type the code your host shared, or open their invite link. Your player then follows the host’s.', placement: 'bottom' },
      { title: 'The Live pill', body: 'While a session runs, a Live pill sits on every other page. Tap it to return to the room.' },
      { title: 'Tap to start listening', body: 'If your browser holds back sound, the pill says Tap to start listening. One tap puts you in step.' },
      { title: 'Songs and reactions', body: 'Guests add songs for everyone and the host’s queue plays them. Reactions show on every screen in the room.', tip: 'End for everyone closes the room. Leave session takes only you out.' },
    ],
  },
  {
    id: 'meet-ai',
    title: 'Ask VinaX AI',
    blurb: 'The message box, files and connectors, and songs you can play from a reply.',
    minutes: 1,
    emoji: '✨',
    steps: [
      { route: '/VinaXAI', target: 'textarea[aria-label="Message VinaX AI"]', title: 'The message box', body: 'Ask about writing, code, maths, translation or music. Type / for commands such as /playlist and /lyrics.', placement: 'top' },
      { route: '/VinaXAI', target: 'button[aria-label="Attach and tools"]', title: 'Files and connectors', body: 'This button uploads files and turns connectors on or off. Connectors that are on show as chips above the box.', placement: 'top' },
      { route: '/VinaXAI', title: 'Songs you can play', body: 'A “Title — Artist” line in a reply becomes a playable card, with Play all and Save as playlist.' },
      { route: '/VinaXAI', title: 'Where messages go', body: 'Your messages go to the AI service that answers them. Your library and listening stay on this device.' },
    ],
  },
  {
    id: 'ai-styles',
    title: 'VinaX AI: models and chat styles',
    blurb: 'Pick a model, see the chat change to match its maker, or keep one chat style.',
    minutes: 1,
    emoji: '🧩',
    steps: [
      { route: '/VinaXAI', target: 'button[aria-label^="Model:"]', title: 'The model menu', body: 'Auto picks a model for each question. Open this menu to search every free model and choose one yourself.', placement: 'top' },
      { route: '/VinaXAI', title: 'The chat follows the model', body: 'When you choose a model, the chat takes a style that matches its maker: colours, type and message shapes.' },
      { route: '/VinaXAI', target: 'button[aria-label="Chat settings"]', title: 'Chat settings', body: 'This button opens the default model, reply language, voice and chat storage. Press Next to open it.', placement: 'bottom' },
      { route: '/VinaXAI', target: '[data-tour="chat-style"] > span', title: 'Chat style', body: 'Match the model changes the style with each model. Pick any other style to keep it for every chat.', action: click('button[aria-label="Chat settings"]'), leave: () => document.querySelector<HTMLElement>('button[aria-label="Close settings"]')?.click(), placement: 'bottom' },
    ],
  },
  {
    id: 'app-look',
    title: 'Change the app’s look',
    blurb: 'Six app styles, plus theme, accent colour and frosted glass.',
    minutes: 1,
    emoji: '🎨',
    steps: [
      { route: '/settings', target: '[aria-label="App style"] [aria-checked="true"]', title: 'App style', body: 'This is the style in use. Each of the six changes colours, type, shapes, the navigation and the player.', action: reveal('[aria-label="App style"]'), placement: 'bottom' },
      { route: '/settings', title: 'Try another one', body: 'Tap any style and the app changes at once. Your music, library and settings stay as they are.', tip: 'Aura, Pulse, Sangam, Nocturne, Marquee and Vibe.' },
      { route: '/settings', target: '[aria-label="Custom accent colour"]', title: 'Accent colour', body: 'Choose one of the preset accents, or pick any colour here and VinaX builds the palette from it.', action: reveal('[aria-label="Custom accent colour"]'), placement: 'bottom' },
      { route: '/settings', target: '[aria-label="Glass effect intensity"]', title: 'Frosted glass', body: 'This slider sets how see-through the bars, menus and sheets are. Slide toward Solid for plain panels.', action: reveal('[aria-label="Glass effect intensity"]'), placement: 'bottom' },
    ],
  },
  {
    id: 'festival-themes',
    title: 'Festival themes',
    blurb: 'What festival days change, how to preview one now, and how to turn them off.',
    minutes: 1,
    emoji: '🪔',
    steps: [
      { route: '/settings', target: '[aria-label="Festival themes"]', title: 'Festival themes', body: 'On a festival day the app takes that festival’s colours and greeting. Turn this off to keep one look all year.', action: reveal('[aria-label="Festival themes"]'), placement: 'bottom' },
      { route: '/settings', target: 'select[aria-label="Preview a festival"]', title: 'Preview a festival', body: 'Choose any festival here to see its look now. It lasts until you stop it or reload.', action: reveal('select[aria-label="Preview a festival"]'), placement: 'bottom' },
      { route: '/settings', title: 'Stop the preview', body: 'Open the same list and choose Stop preview. Your app style returns as you left it.' },
    ],
  },
  {
    id: 'make-it-yours',
    title: 'Settings worth knowing',
    blurb: 'Search settings, set how far recommendations roam, shape the sound and back up.',
    minutes: 1,
    emoji: '⚙️',
    steps: [
      { route: '/settings', target: 'input[aria-label="Search settings"]', title: 'Find any setting', body: 'Type “theme”, “sleep” or “quality” and only the matching settings stay.', placement: 'bottom' },
      { route: '/settings', target: '[aria-label="Discovery mode"] [aria-checked="true"]', title: 'Discovery mode', body: 'Familiar, Balanced or Discover sets how far recommendations roam. Every queue still opens with familiar songs.', action: reveal('[aria-label="Discovery mode"]'), placement: 'bottom' },
      { route: '/settings', target: '[data-tour="sound"] .vx-set-head', title: 'Sound', body: 'A five-band equaliser, balance, mono and loudness normalisation, processed on your device. Turn on Sound effects first.', action: reveal('[data-tour="sound"] .vx-set-head'), placement: 'bottom' },
      { route: '/settings', title: 'Back up and restore', body: 'Your data exports a backup file. Backup Center previews a restore, merges or replaces, and offers Undo.' },
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
      { route: '/library', title: 'Swipe a song', body: 'On touch screens, swipe a song row right to queue it, left for Listen Later. Song menus offer both.' },
      { route: '/library', title: 'Tidy playlists', body: 'Pin, tag, sort and de-duplicate playlists. A deleted playlist waits in Recently deleted for seven days.' },
    ],
  },
];

export function tutorialById(id: string | null | undefined): Tutorial | null {
  return id ? TUTORIALS.find((t) => t.id === id) ?? null : null;
}
