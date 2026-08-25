/**
 * Deep session context shared by every AI surface (AI DJ, home builder,
 * VinaX AI, AI Playlist) — the personalization layer the owner asked for:
 * the model no longer sees only "evening"; it sees the day-of-week vibe,
 * the listener's live energy, and the festival the app is celebrating.
 *
 * Everything is derived on-device from the clock, the html festival class
 * (which already honors the admin Festival Themes override) and the local
 * listening history. No network, no identifiers.
 *
 * Deliberately does NOT import constants/festivals — that module rides in a
 * lazy chunk, and this file sits in the first-load dj/taste graph. The
 * prepaint script in index.html sets the fest-<id> class before React
 * mounts, so reading the class alone is already reliable.
 */

export interface SessionContext {
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
  ts: number;
}

/** Live energy read from the last few plays: skip-streaks read as restless,
 *  completion streaks as locked-in, silence as fresh session. */
export function readListenerEnergy(history: HistoryLike[], hour: number): string {
  const recent = history.slice(0, 8);
  if (!recent.length) return hour < 5 || hour >= 22 ? 'fresh session late — start mellow' : 'fresh session — open inviting and easy';
  const skips = recent.filter((e) => e.completed === false).length;
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
  const ctx: SessionContext = {
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
