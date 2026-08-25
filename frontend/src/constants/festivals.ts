export interface Festival {
  id: string;
  greeting: string;
  emoji: string;
  /** Confetti colors. */
  colors: string[];
  /** Inclusive [month, day] windows (1-based months). Lunar dates are 2026. */
  windows: Array<[number, number, number, number]>; // mFrom,dFrom,mTo,dTo
}

/**
 * Festival calendar. Fixed-date festivals repeat yearly; lunar ones carry
 * 2026 dates and should be refreshed annually (single file to update).
 */
export const FESTIVALS: Festival[] = [
  { id: 'sankranti', greeting: 'Happy Sankranti & Pongal', emoji: '🪁', colors: ['#f59e0b', '#fde047', '#fb923c', '#22c55e'], windows: [[1, 13, 1, 16]] },
  { id: 'republic', greeting: 'Happy Republic Day', emoji: '🇮🇳', colors: ['#f97316', '#ffffff', '#22c55e', '#3b82f6'], windows: [[1, 25, 1, 26]] },
  { id: 'shivaratri', greeting: 'Happy Maha Shivaratri', emoji: '🔱', colors: ['#94a3b8', '#60a5fa', '#1e3a8a', '#ffffff'], windows: [[2, 14, 2, 15]] },
  { id: 'holi', greeting: 'Happy Holi', emoji: '🎨', colors: ['#ec4899', '#a855f7', '#22d3ee', '#facc15', '#22c55e'], windows: [[3, 3, 3, 4]] },
  { id: 'ugadi', greeting: 'Happy Ugadi', emoji: '🥭', colors: ['#65a30d', '#facc15', '#84cc16', '#fb923c'], windows: [[3, 18, 3, 19]] },
  { id: 'eid', greeting: 'Eid Mubarak', emoji: '🌙', colors: ['#22c55e', '#fde047', '#ffffff'], windows: [[3, 20, 3, 21]] },
  { id: 'bonalu', greeting: 'Bonalu Subhakankshalu', emoji: '🏺', colors: ['#eab308', '#dc2626', '#22c55e'], windows: [[7, 12, 7, 26]] },
  { id: 'independence', greeting: 'Happy 80th Independence Day', emoji: '🇮🇳', colors: ['#f97316', '#ffffff', '#22c55e', '#3b82f6'], windows: [[8, 14, 8, 15]] },
  { id: 'onam', greeting: 'Happy Onam', emoji: '🌼', colors: ['#facc15', '#fb923c', '#22c55e', '#ffffff'], windows: [[8, 25, 8, 27]] },
  { id: 'janmashtami', greeting: 'Happy Krishna Janmashtami', emoji: '🦚', colors: ['#0ea5e9', '#fde047', '#a855f7', '#22d3ee'], windows: [[9, 3, 9, 4]] },
  { id: 'ganesh', greeting: 'Happy Ganesh Chaturthi', emoji: '🐘', colors: ['#fb923c', '#ef4444', '#facc15'], windows: [[9, 13, 9, 15]] },
  { id: 'bathukamma', greeting: 'Bathukamma Subhakankshalu', emoji: '🌸', colors: ['#ec4899', '#f59e0b', '#facc15', '#22c55e'], windows: [[10, 10, 10, 18]] },
  { id: 'dussehra', greeting: 'Happy Dussehra', emoji: '🏹', colors: ['#ef4444', '#facc15', '#fb923c'], windows: [[10, 19, 10, 20]] },
  { id: 'diwali', greeting: 'Happy Diwali', emoji: '🪔', colors: ['#facc15', '#fb923c', '#ef4444', '#a855f7'], windows: [[11, 7, 11, 9]] },
  // Force-only via the admin Festival Themes panel (month-long observance —
  // no auto window so it never self-activates).
  { id: 'karthika', greeting: 'Karthika Masam Subhakankshalu', emoji: '🪔', colors: ['#f59e0b', '#fb923c', '#fde047'], windows: [] },
  { id: 'christmas', greeting: 'Merry Christmas', emoji: '🎄', colors: ['#ef4444', '#22c55e', '#ffffff', '#facc15'], windows: [[12, 24, 12, 25]] },
  { id: 'newyear', greeting: 'Happy New Year', emoji: '🎆', colors: ['#facc15', '#22d3ee', '#a855f7', '#fb7185'], windows: [[12, 31, 12, 31], [1, 1, 1, 1]] },
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
