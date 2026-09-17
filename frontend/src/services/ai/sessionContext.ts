/**
 * Deep session context shared by VinaX AI and AI Playlist — the personalization layer the owner asked for:
 * the model no longer sees only "evening"; it sees the day-of-week vibe,
 * the listener's live energy, and the festival the app is celebrating.
 *
 * Everything is derived on-device from the clock, the html festival class
 * (which already honors the admin Festival Themes override) and the local
 * listening history. No network, no identifiers.
 *
 * Deliberately does NOT import constants/festivals — that module rides in a
 * lazy chunk, and this file sits in the taste snapshot graph. The
 * prepaint script in index.html sets the fest-<id> class before React
 * mounts, so reading the class alone is already reliable.
 */

import { isSkippedPlay } from '@/utils/plays';

/** v6.4.0 — a named session state, INFERRED from behaviour and clock; never a claim about feelings. */
export type SessionState = 'CALM' | 'FOCUSED' | 'ENERGETIC' | 'RESTLESS' | 'WAVERING' | 'LOCKED_IN' | 'LATE_NIGHT' | 'MORNING' | 'PARTY' | 'WIND_DOWN';

export interface SessionContext {
  /** v6.4.0 — one of the named states above (derived; see sessionStateOf). */
  sessionState: SessionState;
  /** v6.4.0 — skips among the last eight plays. */
  recentSkipCount: number;
  /** v6.4.0 — 0..1 completion share among the last eight plays (1 when nothing played). */
  recentCompletionRate: number;
  /** v6.4.0 — minutes since the first play of the current sitting (≤ 30-minute gaps), 0 when idle. */
  sessionDurationMin: number;
  /** v6.4.0 — language / lead artist of the most recent play, when known. */
  recentLanguage?: string;
  recentArtist?: string;
  timeOfDay: string;
  /** India-aware hour × weekday vibe ("saturday night / party & dance"). */
  sessionVibe: string;
  dayOfWeek: string;
  isWeekend: boolean;
  /** Live read of the listener: locked-in, restless, winding down… */
  listenerEnergy: string;
  /** Present only during a festival window (or admin-forced festival). */
  festivalContext?: string;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const FESTIVAL_LINES: Record<string, string> = {
  sankranti: 'Sankranti/Pongal — harvest joy: folk beats, kite-flying energy, family warmth',
  republic: 'Republic Day — patriotic pride: desh-bhakti anthems fit naturally',
  shivaratri: 'Maha Shivaratri — devotional night: Shiva bhajans and meditative tracks fit',
  holi: 'Holi — colours and mischief: high-energy party and playful duets fit',
  ugadi: 'Ugadi — Telugu new year: fresh starts, classic Telugu melodies, festive family mood',
  eid: 'Eid — celebration and warmth: qawwali, sufi and joyous festive songs fit',
  ramanavami: 'Sri Rama Navami — devotional: Rama bhajans and classical devotional pieces fit',
  easter: 'Easter — hope and joy: uplifting and gospel-tinged tracks fit',
  hanuman: 'Hanuman Jayanti — strength and devotion: Hanuman bhajans fit',
  bonalu: 'Bonalu — Telangana folk festival: teenmaar beats and folk goddess songs fit',
  independence: 'Independence Day — patriotic: freedom anthems and desh-bhakti classics fit',
  varalakshmi: 'Varalakshmi Vratam — auspicious morning: devotional and classical pieces fit',
  onam: 'Onam — Kerala harvest: Malayalam onappattu and boat-song rhythms fit',
  janmashtami: 'Krishna Janmashtami — playful devotion: Krishna songs and flute melodies fit',
  ganesh: 'Ganesh Chaturthi — festive devotion: Ganesha songs and dhol energy fit',
  bathukamma: 'Bathukamma — Telangana flower festival: women\'s folk chorus songs fit',
  dussehra: 'Dussehra — victory of good: triumphant, powerful tracks fit',
  diwali: 'Diwali — festival of lights: celebratory, sparkling, family-party songs fit',
  nagula: 'Nagula Chavithi — traditional observance: calm devotional pieces fit',
  karthika: 'Karthika Masam — month of lamps: Shiva/Vishnu devotional and serene tracks fit',
  vaikunta: 'Vaikunta Ekadasi — temple dawn: Vishnu suprabhatham and devotional classics fit',
  christmas: 'Christmas — carols and cheer: festive and warm family songs fit',
  newyear: 'New Year — countdown energy: biggest hits and celebration anthems fit',
  valentine: 'Valentine’s Day — romance: love duets, slow melodies and dedication songs fit',
  womensday: 'Women’s Day — celebration of women: female-led anthems and empowering tracks fit',
  vishu: 'Vishu / Baisakhi / Puthandu / Bihu — regional new year: Malayalam, Punjabi bhangra, Tamil and Assamese folk fit',
  akshaya: 'Akshaya Tritiya — auspicious day: Lakshmi devotional and classical pieces fit',
  buddha: 'Buddha Purnima — calm and compassion: meditative, serene, instrumental tracks fit',
  mothersday: 'Mother’s Day — gratitude: songs about mothers (maa/amma) and gentle melodies fit',
  bakrid: 'Eid ul-Adha — celebration: qawwali, sufi and festive family songs fit',
  telangana: 'Telangana Formation Day — state pride: Telangana folk, teenmaar and regional anthems fit',
  fathersday: 'Father’s Day — warmth and gratitude: songs about fathers (nanna/papa) fit',
  gurupurnima: 'Guru Purnima — reverence for teachers: devotional and classical pieces fit',
  friendship: 'Friendship Day — friends and fun: friendship anthems (dosti/sneham) and party tracks fit',
  rakhi: 'Raksha Bandhan — sibling bond: songs about brothers and sisters, warm family tracks fit',
  teachers: 'Teachers’ Day — gratitude: inspiring, motivational and nostalgic school-era songs fit',
  gandhi: 'Gandhi Jayanti — peace and reflection: bhajans like Vaishnav Jan To and patriotic classics fit',
  navratri: 'Navratri / Durga Puja — nine nights of garba and dandiya: high-energy folk-dance and Devi devotional fit',
  halloween: 'Halloween — playful spook: dark, dramatic, bass-heavy and eerie tracks fit',
  apformation: 'Andhra Pradesh Formation Day — state pride: Andhra folk and regional anthems fit',
  childrens: 'Children’s Day — playful joy: kids’ favourites, cartoon themes and upbeat sing-alongs fit',
  chhath: 'Chhath Puja — dawn by the river: Bhojpuri Chhath geet and Surya devotional songs fit',
  gurunanak: 'Guru Nanak Jayanti — gurbani and shabad kirtan, Punjabi devotional fit',
};

/** Festival the app is visibly celebrating right now, read from the live
 *  html class — set at prepaint by index.html and kept current by
 *  FestiveSplash, INCLUDING the admin force/off override. */
function currentFestivalId(): string | null {
  if (typeof document === 'undefined') return null;
  for (const c of Array.from(document.documentElement.classList)) {
    if (c.startsWith('fest-')) {
      const id = c.slice(5);
      return id === 'ind' ? 'independence' : id;
    }
  }
  return null;
}

interface HistoryLike {
  completed?: boolean;
  /** v7.0.0 — explicit skip flag; see utils/plays. */
  skipped?: boolean;
  listenedSec?: number;
  ts: number;
  song?: { language?: string | null; artists?: Array<{ name: string }>; subtitle?: string };
}

const SITTING_GAP_MS = 30 * 60_000;

/** Minutes covered by the current sitting: consecutive plays ≤ 30 min apart, ending now-ish. */
export function sessionDurationMinutes(history: HistoryLike[], now = Date.now()): number {
  if (!history.length || now - history[0].ts > SITTING_GAP_MS) return 0;
  let start = history[0].ts;
  for (let i = 1; i < history.length; i += 1) {
    if (history[i - 1].ts - history[i].ts > SITTING_GAP_MS) break;
    start = history[i].ts;
  }
  return Math.max(0, Math.round((now - start) / 60_000));
}

/**
 * v6.4.0 — the named state. Behaviour first (skip streaks, completion
 * streaks), then the clock. Deliberately coarse: this is context for
 * ranking, not a verdict on the listener's mood.
 */
export function sessionStateOf(args: { hour: number; day: number; skips: number; completionRate: number; plays: number; sittingMin: number }): SessionState {
  const { hour, day, skips, completionRate, plays, sittingMin } = args;
  const weekendNight = (day === 5 || day === 6) && hour >= 20;
  if (plays >= 2 && skips >= 4) return 'RESTLESS';
  if (plays >= 2 && skips >= 2) return 'WAVERING';
  if (hour >= 22 || hour < 5) return sittingMin >= 45 ? 'WIND_DOWN' : 'LATE_NIGHT';
  if (weekendNight) return 'PARTY';
  if (hour >= 5 && hour < 10) return 'MORNING';
  if (plays >= 4 && completionRate >= 0.85) return 'LOCKED_IN';
  if (sittingMin >= 60 && completionRate >= 0.7) return 'FOCUSED';
  if (hour >= 17 && hour < 22 && (day === 5 || day === 6)) return 'ENERGETIC';
  return 'CALM';
}

/** Live energy read from the last few plays: skip-streaks read as restless,
 *  completion streaks as locked-in, silence as fresh session. */
export function readListenerEnergy(history: HistoryLike[], hour: number): string {
  const recent = history.slice(0, 8);
  if (!recent.length) return hour < 5 || hour >= 22 ? 'fresh session late — start mellow' : 'fresh session — open inviting and easy';
  const skips = recent.filter(isSkippedPlay).length;
  const lastGap = Date.now() - recent[0].ts;
  if (skips >= 4) return 'restless — recent picks are missing; change direction and lift the energy';
  if (skips >= 2) return 'wavering — mix in a safe favourite to re-anchor, then build';
  if (lastGap > 6 * 3_600_000) return 'returning after a break — re-open with a loved familiar track, then flow';
  if (hour >= 22 || hour < 5) return 'locked in, late hours — keep it smooth and let energy glide down';
  return 'locked in — the flow is landing; sustain and gently raise the energy';
}

export function buildSessionContext(history: HistoryLike[] = [], now = new Date()): SessionContext {
  const h = now.getHours();
  const d = now.getDay();
  const isWeekend = d === 0 || d === 6;
  const timeOfDay = h < 5 ? 'late night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night';
  let sessionVibe: string;
  if (h >= 5 && h < 9 && d === 0) sessionVibe = 'sunday early morning / calm, many listeners play devotional now';
  else if (h >= 5 && h < 10) sessionVibe = 'fresh morning / energising start to the day';
  else if (h < 5) sessionVibe = 'deep late night / mellow, romantic, wind-down';
  else if (h < 14) sessionVibe = isWeekend ? 'weekend midday / relaxed and bright' : 'workday midday / steady focus-friendly';
  else if (h < 17) sessionVibe = 'afternoon / easy energy, chai-time';
  else if (h < 20) sessionVibe = isWeekend ? 'weekend evening / social, lively' : 'evening unwind / shed the workday';
  else if ((d === 5 || d === 6) && h >= 20) sessionVibe = 'friday-saturday night / party, dance, celebration';
  else sessionVibe = 'night / warm, melodic, easing down';
  const recent = history.slice(0, 8);
  // v7.0.0 — a skip is a skip, not "anything unfinished": the song playing
  // right now and a song paused halfway used to be counted against the read.
  const skips = recent.filter(isSkippedPlay).length;
  const judged = recent.filter((e) => e.completed === true || isSkippedPlay(e));
  const completionRate = judged.length ? judged.filter((e) => e.completed === true).length / judged.length : 1;
  const sittingMin = sessionDurationMinutes(history, now.getTime());
  const last = history[0]?.song;
  const ctx: SessionContext = {
    sessionState: sessionStateOf({ hour: h, day: d, skips, completionRate, plays: recent.length, sittingMin }),
    recentSkipCount: skips,
    recentCompletionRate: Math.round(completionRate * 100) / 100,
    sessionDurationMin: sittingMin,
    ...(last?.language && last.language !== 'unknown' ? { recentLanguage: last.language } : {}),
    ...(last?.artists?.[0]?.name || last?.subtitle ? { recentArtist: (last.artists?.[0]?.name ?? last.subtitle?.split(',')[0] ?? '').trim() } : {}),
    timeOfDay,
    sessionVibe,
    dayOfWeek: DAYS[d],
    isWeekend,
    listenerEnergy: readListenerEnergy(history, h),
  };
  const fid = currentFestivalId();
  if (fid) {
    ctx.festivalContext = FESTIVAL_LINES[fid] ?? `${fid} festival — festive songs fit naturally`;
  }
  return ctx;
}
