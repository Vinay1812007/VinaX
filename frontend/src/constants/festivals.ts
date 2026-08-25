export interface FestivalBackdrop {
  /** Emoji particles the ambient backdrop animates. */
  p: string[];
  /** How the particles move: rise from below, fall from above, or drift across. */
  motion: 'rise' | 'fall' | 'drift';
  /** Particle count on larger screens (phones show ~60%). */
  density?: number;
}

export interface Festival {
  id: string;
  greeting: string;
  emoji: string;
  /** Confetti colors (splash) — also the admin panel's palette preview. */
  colors: string[];
  /** Inclusive [month, day] windows (1-based months). Lunar dates are 2026. */
  windows: Array<[number, number, number, number]>; // mFrom,dFrom,mTo,dTo
  /** Ambient living backdrop, mounted after boot for the whole window. */
  backdrop?: FestivalBackdrop;
}

/**
 * Festival calendar + theme data (redesigned 5.2.x — owner request: every
 * festival should FEEL different, not just recolor the accent).
 *
 * Each festival now carries three layers, all keyed off `fest-<id>`:
 *   1. accent ramp + top ribbon + brand badge   (styles/index.css)
 *   2. ambient glow                             (.fest-sky::before, CSS)
 *   3. living emoji backdrop                    (`backdrop` below, rendered
 *      by FestBackdrop in FestiveSplash.tsx — rise / fall / drift motions)
 *
 * Fixed-date festivals repeat yearly; lunar ones carry 2026 dates and are
 * refreshed annually (this single file + the pre-paint table in index.html).
 * Independence Day additionally keeps its hand-drawn waving-tricolor art.
 */
export const FESTIVALS: Festival[] = [
  { id: 'sankranti', greeting: 'Happy Sankranti & Pongal', emoji: '🪁', colors: ['#f59e0b', '#fde047', '#fb923c', '#22c55e'], windows: [[1, 13, 1, 16]], backdrop: { p: ['🪁', '🪁', '✨'], motion: 'drift', density: 12 } },
  { id: 'republic', greeting: 'Happy Republic Day', emoji: '🇮🇳', colors: ['#f97316', '#ffffff', '#22c55e', '#3b82f6'], windows: [[1, 25, 1, 26]], backdrop: { p: ['🎈', '🇮🇳', '🎈'], motion: 'rise', density: 12 } },
  { id: 'shivaratri', greeting: 'Happy Maha Shivaratri', emoji: '🔱', colors: ['#94a3b8', '#60a5fa', '#1e3a8a', '#ffffff'], windows: [[2, 14, 2, 15]], backdrop: { p: ['🔱', '🌙', '✨'], motion: 'drift', density: 10 } },
  { id: 'holi', greeting: 'Happy Holi', emoji: '🎨', colors: ['#ec4899', '#a855f7', '#22d3ee', '#facc15', '#22c55e'], windows: [[3, 3, 3, 4]], backdrop: { p: ['🟣', '🟢', '🟡', '🔴', '🔵'], motion: 'fall', density: 18 } },
  { id: 'ugadi', greeting: 'Happy Ugadi', emoji: '🥭', colors: ['#65a30d', '#facc15', '#84cc16', '#fb923c'], windows: [[3, 18, 3, 19]], backdrop: { p: ['🥭', '🍃', '🍃'], motion: 'fall', density: 14 } },
  { id: 'eid', greeting: 'Eid Mubarak', emoji: '🌙', colors: ['#22c55e', '#fde047', '#ffffff'], windows: [[3, 20, 3, 21]], backdrop: { p: ['🏮', '🌙', '⭐'], motion: 'rise', density: 12 } },
  { id: 'ramanavami', greeting: 'Sri Rama Navami Subhakankshalu', emoji: '🚩', colors: ['#f97316', '#facc15', '#fef3c7'], windows: [[3, 26, 3, 27]], backdrop: { p: ['🚩', '🌼', '✨'], motion: 'rise', density: 12 } },
  { id: 'easter', greeting: 'Happy Easter', emoji: '✝️', colors: ['#a78bfa', '#fde047', '#ffffff', '#f9a8d4'], windows: [[4, 3, 4, 5]], backdrop: { p: ['🕊️', '✨', '🌷'], motion: 'rise', density: 10 } },
  { id: 'hanuman', greeting: 'Hanuman Jayanti Subhakankshalu', emoji: '🚩', colors: ['#ea580c', '#f59e0b', '#fde047'], windows: [[5, 12, 5, 13]], backdrop: { p: ['🚩', '🌺', '✨'], motion: 'rise', density: 12 } },
  { id: 'bonalu', greeting: 'Bonalu Subhakankshalu', emoji: '🏺', colors: ['#eab308', '#dc2626', '#22c55e'], windows: [[7, 12, 7, 26]], backdrop: { p: ['🌿', '🌼', '🔔'], motion: 'fall', density: 13 } },
  { id: 'independence', greeting: 'Happy Independence Day', emoji: '🇮🇳', colors: ['#f97316', '#ffffff', '#22c55e', '#3b82f6'], windows: [[8, 14, 8, 15]] },
  { id: 'varalakshmi', greeting: 'Varalakshmi Vratam Subhakankshalu', emoji: '🪷', colors: ['#ec4899', '#f59e0b', '#fde047'], windows: [[8, 21, 8, 21]], backdrop: { p: ['🪷', '✨', '🌺'], motion: 'rise', density: 12 } },
  { id: 'onam', greeting: 'Happy Onam', emoji: '🌼', colors: ['#facc15', '#fb923c', '#22c55e', '#ffffff'], windows: [[8, 25, 8, 27]], backdrop: { p: ['🌼', '🌺', '🌸'], motion: 'fall', density: 16 } },
  { id: 'janmashtami', greeting: 'Happy Krishna Janmashtami', emoji: '🦚', colors: ['#0ea5e9', '#fde047', '#a855f7', '#22d3ee'], windows: [[9, 3, 9, 4]], backdrop: { p: ['🪶', '🦚', '✨'], motion: 'drift', density: 10 } },
  { id: 'ganesh', greeting: 'Happy Ganesh Chaturthi', emoji: '🐘', colors: ['#fb923c', '#ef4444', '#facc15'], windows: [[9, 13, 9, 15]], backdrop: { p: ['🌺', '🪔', '✨'], motion: 'fall', density: 14 } },
  { id: 'bathukamma', greeting: 'Bathukamma Subhakankshalu', emoji: '🌸', colors: ['#ec4899', '#f59e0b', '#facc15', '#22c55e'], windows: [[10, 10, 10, 18]], backdrop: { p: ['🌸', '🌼', '🌺'], motion: 'fall', density: 16 } },
  { id: 'dussehra', greeting: 'Happy Dussehra', emoji: '🏹', colors: ['#ef4444', '#facc15', '#fb923c'], windows: [[10, 19, 10, 20]], backdrop: { p: ['🏹', '🌼', '✨'], motion: 'drift', density: 11 } },
  { id: 'diwali', greeting: 'Happy Diwali', emoji: '🪔', colors: ['#facc15', '#fb923c', '#ef4444', '#a855f7'], windows: [[11, 7, 11, 9]], backdrop: { p: ['🪔', '✨', '🎆'], motion: 'rise', density: 16 } },
  { id: 'nagula', greeting: 'Nagula Chavithi Subhakankshalu', emoji: '🐍', colors: ['#22c55e', '#eab308', '#a3e635'], windows: [[11, 13, 11, 14]], backdrop: { p: ['🌼', '🐍', '🌿'], motion: 'fall', density: 10 } },
  // Force-only via the admin Festival Themes panel (month-long observance —
  // no auto window so it never self-activates).
  { id: 'karthika', greeting: 'Karthika Masam Subhakankshalu', emoji: '🪔', colors: ['#f59e0b', '#fb923c', '#fde047'], windows: [], backdrop: { p: ['🪔', '🪔', '✨'], motion: 'rise', density: 14 } },
  { id: 'vaikunta', greeting: 'Vaikunta Ekadasi Subhakankshalu', emoji: '🛕', colors: ['#fbbf24', '#a78bfa', '#fef3c7'], windows: [[12, 19, 12, 20]], backdrop: { p: ['🪷', '✨', '🛕'], motion: 'rise', density: 11 } },
  { id: 'christmas', greeting: 'Merry Christmas', emoji: '🎄', colors: ['#ef4444', '#22c55e', '#ffffff', '#facc15'], windows: [[12, 24, 12, 25]], backdrop: { p: ['❄️', '❄️', '✨'], motion: 'fall', density: 18 } },
  { id: 'newyear', greeting: 'Happy New Year', emoji: '🎆', colors: ['#facc15', '#22d3ee', '#a855f7', '#fb7185'], windows: [[12, 31, 12, 31], [1, 1, 1, 1]], backdrop: { p: ['🎆', '🎇', '✨'], motion: 'rise', density: 15 } },
];

export function activeFestival(date = new Date()): Festival | null {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const v = m * 100 + d;
  for (const f of FESTIVALS) {
    for (const [mf, df, mt, dt] of f.windows) {
      if (v >= mf * 100 + df && v <= mt * 100 + dt) return f;
    }
  }
  return null;
}

/**
 * Theme window (owner request): each festival's SKIN applies from the day
 * BEFORE its calendar window through its last day, then the app reverts to
 * the normal theme the morning after. The splash/greeting keeps using
 * activeFestival (real window only) — this wider check drives only the
 * fest-<id> CSS class. Keep the inline pre-paint table in index.html in
 * sync when editing FESTIVALS.
 */
export function activeFestivalTheme(date = new Date()): Festival | null {
  return activeFestival(date) ?? activeFestival(new Date(date.getTime() + 86_400_000));
}

/**
 * Admin override (Festival Themes panel → vinax_config key 'festival'):
 *   { mode: 'off' }               → no festival, even inside a window
 *   { mode: 'force', id: 'holi' } → that festival's splash + skin, today
 *   anything else / null          → 'auto': the calendar above decides
 */
export interface FestivalOverride {
  mode?: 'auto' | 'off' | 'force';
  id?: string;
}

export function resolveFestival(o: FestivalOverride | null | undefined, date = new Date()): Festival | null {
  if (o?.mode === 'off') return null;
  if (o?.mode === 'force' && o.id) return FESTIVALS.find((f) => f.id === o.id) ?? null;
  return activeFestival(date);
}

export function resolveFestivalTheme(o: FestivalOverride | null | undefined, date = new Date()): Festival | null {
  if (o?.mode === 'off') return null;
  if (o?.mode === 'force' && o.id) return FESTIVALS.find((f) => f.id === o.id) ?? null;
  return activeFestivalTheme(date);
}
