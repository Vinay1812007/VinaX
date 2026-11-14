import { searchSongs } from '@/services/api';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTogether } from '@/services/together/session';
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
 * search, Listen Together), a Listen Together tour, and
 * every step driven in a real browser at phone and desktop sizes: a target
 * at the top of the screen takes `placement: 'bottom'` (a card placed above
 * it would sit off-screen), and a target further down a long page needs
 * `reveal` (below).
 *
 * 11.0 rewrite — every tour re-walked against the six app styles; a title is
 * at most 5 words and a body one or two sentences. New tour: the app's look.
 * A step whose anchor
 * is missing is skipped by the runner, and tutorials.test.ts fails when a
 * `data-tour` id or an aria-label a selector names is no longer in the source.
 *
 * 1.12.12 — Listen Together gets an introduction and two tours. "Listen
 * Together" says what it is and walks hosting and the three ways in (code, QR,
 * invite link) on the idle page. "Inside a room" runs in a LIVE room and
 * points at its real controls; the steps that belong to the other role (Share
 * invite for a host, Fine-tune for a guest) say so through `when` and are
 * skipped at once. A tour that cannot run right now says why through `needs`.
 * Every step of both takes `reveal`: a room is a long page on a phone, and the
 * listener starts the tour from a button halfway down it, so even the status
 * line at the top can be off screen when its step comes.
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
  /** False when this step is not for this listener right now (a host-only control): skipped at once, with no wait for its anchor. */
  when?: () => boolean;
}

export interface Tutorial {
  id: string;
  title: string;
  blurb: string;
  minutes: number;
  emoji: string;
  /** True when the walkthrough starts real playback. */
  playsMusic?: boolean;
  /** Why this tour cannot run right now (it needs a live room); null when it can. */
  needs?: () => string | null;
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

/** The Listen Together page shows its Host and Join cards only outside a room. */
const idle = (): boolean => useTogether.getState().mode === 'idle';

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
      { route: '/', target: '.vx-topbar', title: 'Where you are', body: 'The top bar holds this page’s actions. Home, Search, Library and VinaX AI sit in the navigation.', placement: 'bottom' },
      { route: '/', target: '[data-tour="hero-play"]', title: 'Your mix', body: 'This button plays a mix built from your languages and listening. Press Next and the tour starts a song.', placement: 'bottom' },
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
      { route: '/search', target: SEARCH, title: 'Search by lyrics', body: 'Type five or more words of a lyric and VinaX offers Search by lyrics.', placement: 'bottom' },
      { route: '/search', title: 'Recent and trending', body: 'Long-press or hover a recent search to pin it. Tap a trending chip to search it.', tip: 'Press ⌘/Ctrl+K anywhere for the command palette.' },
      { route: '/discover', target: 'nav[aria-label="Browse music"] a[href="/charts"]', title: 'Discover', body: 'Charts, Languages and Moods lead this grid. Regions, Movies, Videos and mixes follow.', placement: 'bottom' },
    ],
  },
  {
    id: 'listen-together',
    title: 'Listen Together',
    blurb: 'What it is, how to host a room, and the three ways a friend gets in.',
    minutes: 2,
    emoji: '🎧',
    steps: [
      { route: '/together', title: 'Meet Listen Together', body: 'One song, at the same second, on every phone in the room. It is free and runs in a browser, with no app to install.', tip: 'About a minute. Nothing starts until you tap it yourself.' },
      { route: '/together', target: 'section[aria-labelledby="vx-lt-start"] .vx-lt-cta', action: reveal('section[aria-labelledby="vx-lt-start"] .vx-lt-cta'), when: idle, title: 'Host a session', body: 'Start a session to get a room code, a QR and an invite link. Everyone shares one queue, and hears the same second.', placement: 'bottom' },
      { route: '/together', target: '.vx-lt-steps', action: reveal('.vx-lt-steps'), when: idle, title: 'Bring your friends', body: 'Share the invite link, let them scan the QR, or read out the code. Everyone who joins hears exactly what you play.', placement: 'bottom' },
      { route: '/together', target: '#vx-lt-code', action: reveal('#vx-lt-code'), when: idle, title: 'Join with a code', body: 'Type the code your host shared and tap Join. Your player then follows the room.', placement: 'bottom' },
      { route: '/together', target: '.vx-lt-scan-btn', action: reveal('.vx-lt-scan-btn'), when: idle, title: 'Or scan the QR', body: 'This opens the camera inside VinaX and joins when it reads the host’s QR. The camera is on only while the scanner is open.', placement: 'top' },
      { title: 'A link joins by itself', body: 'Open a host’s invite link and you are in the room, with no code to type.' },
      { title: 'Tap to start listening', body: 'Browsers do not start sound by themselves. If this button shows after you join, one tap puts you in step.' },
      { title: 'From the player too', body: 'The full-screen player has a Together tab after Credits. It starts a room with the song that is playing.' },
      { title: 'The Live pill', body: 'While a room is live, a pill sits on every other page. Tap it to return to the room.' },
      { title: 'Inside the room', body: 'Play, pause and skip for everyone, a shared queue, chat and reactions are in the room. Tap Show me around there for a tour of them.' },
    ],
  },
  {
    id: 'together-room',
    title: 'Inside a room',
    blurb: 'The room code, reactions, chat, adding songs and the fine-tune. Runs in a live Listen Together room.',
    minutes: 1,
    emoji: '👥',
    needs: () => (idle() ? 'Start or join a room first. This tour runs inside it.' : null),
    steps: [
      { route: '/together', target: '[data-tour="lt-status"]', action: reveal('[data-tour="lt-status"]'), title: 'You are live', body: 'This line is the room’s state: live, in sync, catching up or reconnecting. A guest sees In sync once the two players match.', placement: 'bottom' },
      { route: '/together', target: '[data-tour="lt-code"]', action: reveal('[data-tour="lt-code"]'), title: 'Room code and QR', body: 'Friends type this code, or scan the QR with VinaX or their phone’s camera. Anyone in the room can show it.', placement: 'bottom' },
      { route: '/together', target: '[data-tour="lt-invite"]', action: reveal('[data-tour="lt-invite"]'), when: () => useTogether.getState().mode === 'host', title: 'Share the invite', body: 'Share invite sends a link that joins by itself. Copy code is for reading it out or pasting it.', placement: 'bottom' },
      { route: '/together', target: '[aria-label="Playback for everyone"]', action: reveal('[aria-label="Playback for everyone"]'), title: 'Play, pause and skip', body: 'These buttons work for the whole room, and so do the player’s own. The host can keep them to itself with the switch below.', tip: 'A guest can turn off Play on this phone to use the phone as a remote for the host’s speaker.', placement: 'bottom' },
      { route: '/together', target: '[aria-label="Fine-tune this phone"]', action: reveal('[aria-label="Fine-tune this phone"]'), when: () => useTogether.getState().mode === 'guest', title: 'Fine-tune this phone', body: 'If this phone sounds late next to the host’s, tap Earlier. If it sounds early, tap Later.', tip: 'A Bluetooth speaker usually needs a little. It is kept for next time.', placement: 'bottom' },
      { route: '/together', target: '[aria-label="React to the music"]', action: reveal('[aria-label="React to the music"]'), title: 'React', body: 'An emoji floats on every screen in the room. Fill the energy bar together and the whole room goes off.', tip: 'When the host keeps playback to itself, guests get a vote-to-skip button here instead.', placement: 'top' },
      { route: '/together', target: '[data-tour="lt-chat"]', action: reveal('[data-tour="lt-chat"]'), title: 'Chat', body: 'Type a line and everyone in the room sees it.', placement: 'top' },
      { route: '/together', target: '[data-tour="lt-add"]', action: reveal('[data-tour="lt-add"]'), title: 'Add a song', body: 'Search here and tap a song: it goes straight into everyone’s queue, with your name on it. In a friend’s room, tapping any song anywhere in VinaX adds it too.', tip: 'Tap the cross on a song you added to take it out again.', placement: 'top' },
      { route: '/together', target: '#vx-lt-people', action: reveal('#vx-lt-people'), title: 'Who is here', body: 'Everyone in the session, with the host marked. The host can remove someone with the cross by their name.', tip: 'A Live pill on other pages leads back here.', placement: 'top' },
      { route: '/together', target: '[data-tour="lt-leave"]', action: reveal('[data-tour="lt-leave"]'), title: 'End or leave', body: 'A host’s End for everyone closes the room. A guest’s Leave session takes only that guest out.', tip: 'After a song or two, Save this session as a playlist shows just above.', placement: 'top' },
    ],
  },
  {
    id: 'app-look',
    title: 'Change the app’s look',
    blurb: 'Dark, light or black, and your own accent colour.',
    minutes: 1,
    emoji: '🎨',
    steps: [
      { route: '/settings', target: '[aria-label="Theme"] [aria-checked="true"]', title: 'Theme', body: 'This is the theme in use. Choose Dark, Black or Light, or let it follow your device or the time of day.', action: reveal('[aria-label="Theme"]'), placement: 'bottom' },
      { route: '/settings', target: '[aria-label="Custom accent colour"]', title: 'Accent colour', body: 'Choose one of the preset accents, or pick any colour here and VinaX builds the palette from it.', action: reveal('[aria-label="Custom accent colour"]'), placement: 'bottom' },
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
