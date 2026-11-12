/**
 * VinaX AI Live voice — music control. Gemini calls these tools (the Worker
 * declares them: backend _lib/ai/voice.ts LIVE_MUSIC_TOOLS, names and
 * arguments in step) and the page runs them in VinaX's own player, then
 * tells Gemini what happened so it can say it ("Playing Kun Faya Kun by
 * A.R. Rahman"). Nothing here throws: a failure is an answer too.
 */
import { searchSongs } from '@/services/api';
import { usePlayerStore } from '@/store/playerStore';
import type { Song } from '@/types/music';

export const MUSIC_TOOL_NAMES = ['play_music', 'pause_music', 'resume_music', 'next_song', 'previous_song', 'now_playing'] as const;

const describe = (s: Song | undefined | null): { title: string; artist: string } | null =>
  s ? { title: s.title, artist: s.artists?.slice(0, 2).map((a) => a.name).join(', ') || s.subtitle || '' } : null;

const loaded = () => {
  const p = usePlayerStore.getState();
  return { p, song: p.queue[p.index] ?? null };
};

export async function runMusicTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const { p, song } = loaded();
    switch (name) {
      case 'play_music': {
        const query = typeof args.query === 'string' ? args.query.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
        if (!query) return { ok: false, error: 'Say what to play.' };
        const songs = await searchSongs(query, 20);
        if (!songs.length) return { ok: false, found: 0, error: `Nothing found for "${query}".` };
        usePlayerStore.getState().playQueue(songs, 0);
        return { ok: true, playing: describe(songs[0]), upNext: songs.length - 1 };
      }
      case 'pause_music':
        if (!song) return { ok: false, error: 'Nothing is loaded.' };
        if (p.isPlaying) p.togglePlay();
        return { ok: true, paused: describe(song) };
      case 'resume_music':
        if (!song) return { ok: false, error: 'Nothing is loaded. Ask for something to play.' };
        if (!p.isPlaying) p.togglePlay();
        return { ok: true, playing: describe(song) };
      case 'next_song': {
        if (!song) return { ok: false, error: 'Nothing is loaded.' };
        p.next(true);
        return { ok: true, playing: describe(loaded().song) };
      }
      case 'previous_song': {
        if (!song) return { ok: false, error: 'Nothing is loaded.' };
        p.prev();
        return { ok: true, playing: describe(loaded().song) };
      }
      case 'now_playing':
        return { ok: true, song: describe(song), playing: !!song && p.isPlaying };
      default:
        return { ok: false, error: 'Unknown tool.' };
    }
  } catch {
    return { ok: false, error: 'The player could not do that just now.' };
  }
}
