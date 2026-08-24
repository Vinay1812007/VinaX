/**
 * Package A10 — festival / season awareness for the on-device scorer.
 *
 * Reads the shared FESTIVALS calendar (one file ops already maintain for dates)
 * and maps the *musically meaningful* festivals onto a small boost descriptor:
 * the languages and/or moods to lift a touch during that festival's window. Kept
 * out of the eager `constants/festivals.ts` (which the app-shell splash imports)
 * so this never lands in the first-load bundle — only the lazy recommendation
 * path pulls it in.
 */
import { activeFestival } from '@/constants/festivals';
import type { Mood } from './mood';

export interface FestivalMusic {
  id: string;
  languages?: string[];
  moods?: Mood[];
}

// Only festivals with a clear musical lean get an entry; patriotic/new-year
// dates stay visual-only (the FestiveSplash still fires for them).
const MUSIC: Record<string, Omit<FestivalMusic, 'id'>> = {
  sankranti: { languages: ['telugu', 'tamil', 'kannada'] },
  holi: { languages: ['hindi'], moods: ['energetic'] },
  eid: { languages: ['urdu'], moods: ['devotional'] },
  onam: { languages: ['malayalam'] },
  ganesh: { languages: ['marathi'], moods: ['devotional'] },
  dussehra: { moods: ['devotional'] },
  diwali: { languages: ['hindi'], moods: ['devotional'] },
  christmas: { moods: ['devotional'] },
};

/** The active festival's music-boost descriptor, or null when nothing musical
 *  is in season. `date` is injectable for tests. */
export function activeFestivalMusic(date = new Date()): FestivalMusic | null {
  const f = activeFestival(date);
  if (!f) return null;
  const m = MUSIC[f.id];
  return m ? { id: f.id, ...m } : null;
}
