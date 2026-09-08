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
  republic: { languages: ['hindi'], moods: ['energetic'] },
  valentine: { moods: ['romantic'] },
  shivaratri: { moods: ['devotional'] },
  holi: { languages: ['hindi'], moods: ['energetic'] },
  womensday: { moods: ['energetic'] },
  ugadi: { languages: ['telugu', 'kannada', 'marathi'] },
  eid: { languages: ['urdu'], moods: ['devotional'] },
  ramanavami: { moods: ['devotional'] },
  easter: { moods: ['devotional', 'chill'] },
  vishu: { languages: ['malayalam', 'tamil', 'punjabi'] },
  akshaya: { moods: ['devotional'] },
  buddha: { moods: ['chill', 'devotional'] },
  mothersday: { moods: ['romantic', 'chill'] },
  hanuman: { moods: ['devotional'] },
  bakrid: { languages: ['urdu'], moods: ['devotional'] },
  telangana: { languages: ['telugu'], moods: ['energetic'] },
  fathersday: { moods: ['chill'] },
  bonalu: { languages: ['telugu'], moods: ['devotional', 'energetic'] },
  gurupurnima: { moods: ['devotional'] },
  friendship: { moods: ['energetic'] },
  independence: { languages: ['hindi'], moods: ['energetic'] },
  varalakshmi: { languages: ['telugu'], moods: ['devotional'] },
  onam: { languages: ['malayalam'] },
  rakhi: { languages: ['hindi'], moods: ['chill'] },
  janmashtami: { moods: ['devotional'] },
  teachers: { moods: ['chill'] },
  ganesh: { languages: ['marathi'], moods: ['devotional'] },
  gandhi: { languages: ['hindi'], moods: ['devotional'] },
  bathukamma: { languages: ['telugu'], moods: ['devotional'] },
  navratri: { languages: ['hindi', 'bengali'], moods: ['energetic', 'devotional'] },
  dussehra: { moods: ['devotional'] },
  halloween: { moods: ['energetic'] },
  apformation: { languages: ['telugu'] },
  diwali: { languages: ['hindi'], moods: ['devotional'] },
  nagula: { languages: ['telugu'], moods: ['devotional'] },
  childrens: { moods: ['energetic'] },
  chhath: { languages: ['bhojpuri', 'hindi'], moods: ['devotional'] },
  karthika: { languages: ['telugu'], moods: ['devotional'] },
  gurunanak: { languages: ['punjabi'], moods: ['devotional'] },
  vaikunta: { languages: ['telugu', 'tamil'], moods: ['devotional'] },
  christmas: { moods: ['devotional'] },
  newyear: { moods: ['energetic'] },
};

/** The active festival's music-boost descriptor, or null when nothing musical
 *  is in season. `date` is injectable for tests. */
export function activeFestivalMusic(date = new Date()): FestivalMusic | null {
  const f = activeFestival(date);
  if (!f) return null;
  const m = MUSIC[f.id];
  return m ? { id: f.id, ...m } : null;
}
