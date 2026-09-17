/**
 * Spoken (or typed) music commands run instantly on the device — no engine
 * round-trip. Extracted from the page in v7.1; behaviour unchanged.
 *
 *   pause / resume / next / previous
 *   play X · queue X · start X · put on X · shuffle X / shuffle songs by X
 *   … in <language> · … without <artist>
 *
 * `say` receives the one-line confirmation (shown as a player card and, in a
 * live voice chat, spoken). Resolves false when the text is not a command —
 * or when search is down, so the assistant answers instead.
 */
import { searchSongs } from '@/services/api';
import { usePlayerStore } from '@/store/playerStore';

export async function tryMusicCommand(text: string, say: (line: string) => void): Promise<boolean> {
  const t = text
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .trim();
  if (/^(pause|stop)(\s+(the\s+)?(music|song|playback))?$/.test(t)) {
    const st = usePlayerStore.getState();
    if (st.isPlaying) st.togglePlay();
    say('Paused.');
    return true;
  }
  if (/^(resume|continue)(\s+(the\s+)?(music|song|playing|playback))?$/.test(t)) {
    const st = usePlayerStore.getState();
    if (!st.isPlaying && st.queue.length) st.togglePlay();
    say('Resuming your music.');
    return true;
  }
  if (/^(next|skip)(\s+(this\s+)?(song|track))?$/.test(t)) {
    usePlayerStore.getState().next(true);
    say('Skipping to the next song.');
    return true;
  }
  if (/^(previous|go back)(\s+(song|track))?$/.test(t)) {
    usePlayerStore.getState().prev();
    say('Going back a song.');
    return true;
  }
  // Package B4 — sub-intent parser layered on top of the play command.
  // Supports:
  //   play X                       — plays X immediately (existing)
  //   queue X                      — enqueues X after the current song
  //   start X / put on X           — synonyms of play
  //   shuffle X / shuffle songs by X — plays a shuffled batch matching X
  //   play X in <language>          — filters results by language
  //   play X without <artist>       — drops any result by that artist
  const playPattern = /^(?:play|queue|start|put on|shuffle)\s+(.+)$/i;
  const cmd = playPattern.exec(text.trim());
  if (cmd) {
    const verb = (
      cmd[0].match(/^(play|queue|start|put on|shuffle)/i)?.[1] ?? 'play'
    ).toLowerCase();
    let rest = cmd[1].trim();
    // Strip trailing filler ("play X song / music / now / please")
    rest = rest.replace(/\s+(?:song|music|now|please)$/i, '').trim();

    // Extract "in <language>" filter.
    let langFilter: string | null = null;
    const langMatch = rest.match(/\s+in\s+([a-z]+)$/i);
    if (langMatch) {
      langFilter = langMatch[1].toLowerCase();
      rest = rest.slice(0, langMatch.index).trim();
    }

    // Extract "without <artist>" exclusion.
    let excludeArtist: string | null = null;
    const withoutMatch = rest.match(/\s+without\s+(.+)$/i);
    if (withoutMatch) {
      excludeArtist = withoutMatch[1].toLowerCase().trim();
      rest = rest.slice(0, withoutMatch.index).trim();
    }

    // "shuffle songs by X" — allow "shuffle songs by AR Rahman" style.
    const shuffleByMatch = rest.match(/^songs?\s+by\s+(.+)$/i);
    if (shuffleByMatch) rest = shuffleByMatch[1].trim();

    if (rest.length > 1) {
      try {
        const rawResults = await searchSongs(rest, verb === 'shuffle' ? 15 : 8);
        let results = rawResults;
        if (langFilter) {
          const matches = results.filter((s) =>
            (s.language ?? '').toLowerCase().startsWith(langFilter),
          );
          if (matches.length) results = matches; // fall through to unfiltered if no language match
        }
        if (excludeArtist) {
          results = results.filter((s) => !s.subtitle.toLowerCase().includes(excludeArtist));
        }
        if (!results.length) {
          say(`I couldn't find “${rest}” — try the song name with the artist.`);
          return true;
        }
        const player = usePlayerStore.getState();
        if (verb === 'queue') {
          player.enqueueNext(results[0]);
          say(`Queued ${results[0].title} by ${results[0].subtitle}.`);
        } else if (verb === 'shuffle') {
          const shuffled = [...results].sort(() => Math.random() - 0.5);
          player.playQueue(shuffled, 0);
          say(`Shuffling ${shuffled.length} tracks from ${rest}.`);
        } else {
          player.playQueue(results, 0);
          const langBit = langFilter ? ` (in ${langFilter})` : '';
          const excludeBit = excludeArtist ? ` (skipping ${excludeArtist})` : '';
          say(`Playing ${results[0].title} by ${results[0].subtitle}${langBit}${excludeBit}.`);
        }
        return true;
      } catch {
        /* search down — let the AI answer instead */
        return false;
      }
    }
  }
  return false;
}
