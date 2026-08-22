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
  { id: 'holi', greeting: 'Happy Holi', emoji: '🎨', colors: ['#ec4899', '#a855f7', '#22d3ee', '#facc15', '#22c55e'], windows: [[3, 3, 3, 4]] },
  { id: 'eid', greeting: 'Eid Mubarak', emoji: '🌙', colors: ['#22c55e', '#fde047', '#ffffff'], windows: [[3, 20, 3, 21]] },
  { id: 'independence', greeting: 'Happy Independence Day', emoji: '🇮🇳', colors: ['#f97316', '#ffffff', '#22c55e', '#3b82f6'], windows: [[8, 14, 8, 15]] },
  { id: 'onam', greeting: 'Happy Onam', emoji: '🌼', colors: ['#facc15', '#fb923c', '#22c55e', '#ffffff'], windows: [[8, 25, 8, 27]] },
  { id: 'ganesh', greeting: 'Happy Ganesh Chaturthi', emoji: '🐘', colors: ['#fb923c', '#ef4444', '#facc15'], windows: [[9, 13, 9, 15]] },
  { id: 'dussehra', greeting: 'Happy Dussehra', emoji: '🏹', colors: ['#ef4444', '#facc15', '#fb923c'], windows: [[10, 19, 10, 20]] },
  { id: 'diwali', greeting: 'Happy Diwali', emoji: '🪔', colors: ['#facc15', '#fb923c', '#ef4444', '#a855f7'], windows: [[11, 7, 11, 9]] },
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
