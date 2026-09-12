export interface FestivalBackdrop {
  /** Legacy particle palette retained for calendar compatibility. */
  p: string[];
  /** How the particles move: rise from below, fall from above, or drift across. */
  motion: 'rise' | 'fall' | 'drift';
  /** Particle count on larger screens (phones show ~60%). */
  density?: number;
}

export interface Festival {
  id: string;
  /** Display name for pickers (Settings, admin console). */
  name: string;
  greeting: string;
  emoji: string;
  /** Confetti colors (splash) — also the admin panel's palette preview. */
  colors: string[];
  /** Inclusive [month, day] windows (1-based months). Lunar dates are 2026. */
  windows: Array<[number, number, number, number]>; // mFrom,dFrom,mTo,dTo
  /** Human calendar line for pickers ("Nov 6–10 (2026)"). */
  when: string;
  /** One line on what the living backdrop does. */
  fx: string;
  /** Ambient living backdrop, mounted after boot for the whole window. */
  backdrop?: FestivalBackdrop;
}

/**
 * Festival calendar (5.14.0 — every festival is now a full, distinct theme).
 *
 * This file is the ONE source of truth for the calendar. Its companion,
 * `festivalThemes.ts`, carries the visual skin per id (accent, canvas tint,
 * glow and motif). `npm run gen:festivals` turns both into:
 *   - src/styles/festivals.css         (html.fest-<id> skins, dark + light)
 *   - the pre-paint window table in index.html (first paint, no flash)
 *   - public/admin/festivals.js        (the admin console's picker data)
 * A unit test fails when any generated file drifts from this data.
 *
 * Matching is first-window-wins in array order, so a festival listed earlier
 * shadows one that overlaps it. Fixed-date festivals repeat yearly; lunar and
 * "nth Sunday" dates carry 2026 values and are refreshed annually.
 * Festivals with `windows: []` never self-activate — the admin console can
 * force them (month-long observances and days that overlap a bigger one).
 */
export const FESTIVALS: Festival[] = [
  { id: 'sankranti', name: 'Sankranti · Pongal · Lohri', greeting: 'Happy Sankranti & Pongal', emoji: '🪁', colors: ['#f59e0b', '#fde047', '#fb923c', '#22c55e'], windows: [[1, 13, 1, 16]], when: 'Jan 13–16', fx: 'Kites drifting through a sunrise glow', backdrop: { p: ['🪁', '🪁', '✨'], motion: 'drift', density: 12 } },
  { id: 'republic', name: 'Republic Day', greeting: 'Happy Republic Day', emoji: '🇮🇳', colors: ['#f97316', '#ffffff', '#22c55e', '#3b82f6'], windows: [[1, 25, 1, 26]], when: 'Jan 25–26', fx: 'Tricolor balloons rising over a navy sky', backdrop: { p: ['🎈', '🇮🇳', '🎈'], motion: 'rise', density: 12 } },
  { id: 'valentine', name: "Valentine's Day", greeting: 'Happy Valentine’s Day', emoji: '💗', colors: ['#f43f5e', '#fb7185', '#fda4af', '#ffffff'], windows: [[2, 13, 2, 14]], when: 'Feb 13–14', fx: 'Hearts floating up through a rose haze', backdrop: { p: ['💗', '💕', '✨'], motion: 'rise', density: 12 } },
  { id: 'shivaratri', name: 'Maha Shivaratri', greeting: 'Happy Maha Shivaratri', emoji: '🔱', colors: ['#94a3b8', '#60a5fa', '#1e3a8a', '#ffffff'], windows: [[2, 15, 2, 15]], when: 'Feb 15 (2026)', fx: 'Trishul and crescent in cold moonlight', backdrop: { p: ['🔱', '🌙', '✨'], motion: 'drift', density: 10 } },
  { id: 'holi', name: 'Holi', greeting: 'Happy Holi', emoji: '🎨', colors: ['#ec4899', '#a855f7', '#22d3ee', '#facc15', '#22c55e'], windows: [[3, 3, 3, 4]], when: 'Mar 3–4 (2026)', fx: 'Colour powder raining through a neon haze', backdrop: { p: ['🟣', '🟢', '🟡', '🔴', '🔵'], motion: 'fall', density: 18 } },
  { id: 'womensday', name: "Women's Day", greeting: 'Happy Women’s Day', emoji: '💜', colors: ['#a855f7', '#c084fc', '#f0abfc', '#ffffff'], windows: [[3, 8, 3, 8]], when: 'Mar 8', fx: 'Violet petals drifting across', backdrop: { p: ['💜', '🌷', '✨'], motion: 'drift', density: 10 } },
  { id: 'ugadi', name: 'Ugadi · Gudi Padwa', greeting: 'Happy Ugadi', emoji: '🥭', colors: ['#a3e635', '#facc15', '#84cc16', '#fb923c'], windows: [[3, 18, 3, 19]], when: 'Mar 18–19 (2026)', fx: 'Mango and neem leaves falling', backdrop: { p: ['🥭', '🍃', '🍃'], motion: 'fall', density: 14 } },
  { id: 'eid', name: 'Eid ul-Fitr', greeting: 'Eid Mubarak', emoji: '🌙', colors: ['#22c55e', '#fde047', '#ffffff'], windows: [[3, 20, 3, 21]], when: 'Mar 20–21 (2026)', fx: 'Lanterns floating under a crescent', backdrop: { p: ['🏮', '🌙', '⭐'], motion: 'rise', density: 12 } },
  { id: 'ramanavami', name: 'Sri Rama Navami', greeting: 'Sri Rama Navami Subhakankshalu', emoji: '🚩', colors: ['#f97316', '#facc15', '#fef3c7'], windows: [[3, 26, 3, 27]], when: 'Mar 26–27 (2026)', fx: 'Saffron flags and marigolds rising', backdrop: { p: ['🚩', '🌼', '✨'], motion: 'rise', density: 12 } },
  { id: 'easter', name: 'Easter', greeting: 'Happy Easter', emoji: '🐣', colors: ['#a78bfa', '#fde047', '#ffffff', '#f9a8d4'], windows: [[4, 3, 4, 5]], when: 'Apr 3–5 (2026)', fx: 'Doves and spring blossoms rising', backdrop: { p: ['🕊️', '✨', '🌷'], motion: 'rise', density: 10 } },
  { id: 'vishu', name: 'Vishu · Baisakhi · Puthandu · Bihu', greeting: 'Happy Vishu & Baisakhi', emoji: '🌾', colors: ['#fbbf24', '#fde68a', '#65a30d', '#ffffff'], windows: [[4, 14, 4, 14]], when: 'Apr 14', fx: 'Golden konna blossoms and wheat drifting', backdrop: { p: ['🌾', '🌼', '✨'], motion: 'drift', density: 12 } },
  { id: 'akshaya', name: 'Akshaya Tritiya', greeting: 'Akshaya Tritiya Subhakankshalu', emoji: '🪙', colors: ['#eab308', '#fde047', '#fef9c3'], windows: [[4, 19, 4, 19]], when: 'Apr 19 (2026)', fx: 'Gold coins glinting as they rise', backdrop: { p: ['🪙', '✨', '🪙'], motion: 'rise', density: 12 } },
  { id: 'buddha', name: 'Buddha Purnima', greeting: 'Happy Buddha Purnima', emoji: '☸️', colors: ['#d4a017', '#fde68a', '#ffffff', '#fb923c'], windows: [[5, 1, 5, 1]], when: 'May 1 (2026)', fx: 'Lotus petals falling in a still golden light', backdrop: { p: ['🪷', '☸️', '✨'], motion: 'fall', density: 9 } },
  { id: 'mothersday', name: "Mother's Day", greeting: 'Happy Mother’s Day', emoji: '💐', colors: ['#f472b6', '#f9a8d4', '#fbcfe8', '#ffffff'], windows: [[5, 10, 5, 10]], when: 'May 10 (2026)', fx: 'Bouquets and petals drifting softly', backdrop: { p: ['💐', '🌸', '💗'], motion: 'drift', density: 10 } },
  { id: 'hanuman', name: 'Hanuman Jayanti', greeting: 'Hanuman Jayanti Subhakankshalu', emoji: '🚩', colors: ['#ea580c', '#f59e0b', '#fde047'], windows: [[5, 12, 5, 13]], when: 'May 12–13 (2026)', fx: 'Vermilion flags and hibiscus rising', backdrop: { p: ['🚩', '🌺', '✨'], motion: 'rise', density: 12 } },
  { id: 'bakrid', name: 'Eid ul-Adha (Bakrid)', greeting: 'Eid Mubarak', emoji: '🕌', colors: ['#10b981', '#6ee7b7', '#fde047', '#ffffff'], windows: [[5, 27, 5, 27]], when: 'May 27 (2026)', fx: 'Lanterns rising past a mosque skyline', backdrop: { p: ['🏮', '🕌', '⭐'], motion: 'rise', density: 11 } },
  { id: 'telangana', name: 'Telangana Formation Day', greeting: 'Happy Telangana Formation Day', emoji: '🏛️', colors: ['#ec4899', '#22c55e', '#ffffff'], windows: [[6, 2, 6, 2]], when: 'Jun 2', fx: 'Pink and green streamers drifting', backdrop: { p: ['🌸', '🍃', '✨'], motion: 'drift', density: 11 } },
  { id: 'fathersday', name: "Father's Day", greeting: 'Happy Father’s Day', emoji: '👔', colors: ['#2563eb', '#60a5fa', '#bfdbfe', '#ffffff'], windows: [[6, 21, 6, 21]], when: 'Jun 21 (2026)', fx: 'Calm blue stars drifting', backdrop: { p: ['⭐', '👔', '✨'], motion: 'drift', density: 9 } },
  { id: 'bonalu', name: 'Bonalu', greeting: 'Bonalu Subhakankshalu', emoji: '🏺', colors: ['#facc15', '#dc2626', '#22c55e'], windows: [[7, 12, 7, 26]], when: 'Jul 12–26 (2026)', fx: 'Turmeric petals, neem and bells falling', backdrop: { p: ['🌿', '🌼', '🔔'], motion: 'fall', density: 13 } },
  { id: 'gurupurnima', name: 'Guru Purnima', greeting: 'Guru Purnima Subhakankshalu', emoji: '📿', colors: ['#b45309', '#f59e0b', '#fde68a', '#ffffff'], windows: [[7, 29, 7, 29]], when: 'Jul 29 (2026)', fx: 'Prayer beads and a full moon drifting', backdrop: { p: ['📿', '🌕', '✨'], motion: 'drift', density: 9 } },
  { id: 'friendship', name: 'Friendship Day', greeting: 'Happy Friendship Day', emoji: '🤝', colors: ['#06b6d4', '#facc15', '#f472b6', '#ffffff'], windows: [[8, 2, 8, 2]], when: 'Aug 2 (2026)', fx: 'Confetti and friendship bands rising', backdrop: { p: ['🎉', '🤝', '✨'], motion: 'rise', density: 12 } },
  { id: 'independence', name: 'Independence Day', greeting: 'Happy Independence Day', emoji: '🇮🇳', colors: ['#f97316', '#ffffff', '#22c55e', '#3b82f6'], windows: [[8, 14, 8, 15]], when: 'Aug 14–15', fx: 'A waving tricolor, Ashoka chakra and rising tricolor lights' },
  { id: 'varalakshmi', name: 'Varalakshmi Vratam', greeting: 'Varalakshmi Vratam Subhakankshalu', emoji: '🪷', colors: ['#f9a8d4', '#f59e0b', '#fde047'], windows: [[8, 21, 8, 21]], when: 'Aug 21 (2026)', fx: 'Lotuses and sparkles rising', backdrop: { p: ['🪷', '✨', '🌺'], motion: 'rise', density: 12 } },
  { id: 'onam', name: 'Onam', greeting: 'Happy Onam', emoji: '🌼', colors: ['#facc15', '#fb923c', '#22c55e', '#ffffff'], windows: [[8, 25, 8, 27]], when: 'Aug 25–27 (2026)', fx: 'Pookalam flowers falling', backdrop: { p: ['🌼', '🌺', '🌸'], motion: 'fall', density: 16 } },
  { id: 'rakhi', name: 'Raksha Bandhan', greeting: 'Happy Raksha Bandhan', emoji: '🎀', colors: ['#fb7185', '#facc15', '#fda4af', '#ffffff'], windows: [[8, 28, 8, 28]], when: 'Aug 28 (2026)', fx: 'Ribbons and sweets drifting', backdrop: { p: ['🎀', '🍬', '✨'], motion: 'drift', density: 10 } },
  { id: 'janmashtami', name: 'Krishna Janmashtami', greeting: 'Happy Krishna Janmashtami', emoji: '🦚', colors: ['#0891b2', '#fde047', '#a855f7', '#22d3ee'], windows: [[9, 3, 9, 4]], when: 'Sep 3–4 (2026)', fx: 'Peacock feathers drifting over teal', backdrop: { p: ['🪶', '🦚', '✨'], motion: 'drift', density: 10 } },
  { id: 'teachers', name: "Teachers' Day", greeting: 'Happy Teachers’ Day', emoji: '📚', colors: ['#6366f1', '#a5b4fc', '#fde047', '#ffffff'], windows: [[9, 5, 9, 5]], when: 'Sep 5', fx: 'Books and stars drifting on indigo', backdrop: { p: ['📚', '⭐', '✨'], motion: 'drift', density: 9 } },
  { id: 'ganesh', name: 'Ganesh Chaturthi', greeting: 'Happy Ganesh Chaturthi', emoji: '🐘', colors: ['#fb923c', '#ef4444', '#facc15'], windows: [[9, 13, 9, 15]], when: 'Sep 13–15 (2026)', fx: 'Hibiscus and diyas falling', backdrop: { p: ['🌺', '🪔', '✨'], motion: 'fall', density: 14 } },
  { id: 'gandhi', name: 'Gandhi Jayanti', greeting: 'Happy Gandhi Jayanti', emoji: '🕊️', colors: ['#a3a3a3', '#ffffff', '#f97316', '#22c55e'], windows: [[10, 2, 10, 2]], when: 'Oct 2', fx: 'White doves drifting on khadi grey', backdrop: { p: ['🕊️', '🕊️', '✨'], motion: 'drift', density: 8 } },
  { id: 'bathukamma', name: 'Bathukamma', greeting: 'Bathukamma Subhakankshalu', emoji: '🌸', colors: ['#e879f9', '#f59e0b', '#facc15', '#22c55e'], windows: [[10, 10, 10, 18]], when: 'Oct 10–18 (2026)', fx: 'Stacked flower rings falling', backdrop: { p: ['🌸', '🌼', '🌺'], motion: 'fall', density: 16 } },
  { id: 'navratri', name: 'Navratri · Durga Puja', greeting: 'Happy Navratri', emoji: '💃', colors: ['#dc2626', '#facc15', '#22c55e', '#a855f7'], windows: [], when: 'Oct 11–19 (2026) · overlaps Bathukamma, force from the console', fx: 'Dandiya sticks and garba lights drifting', backdrop: { p: ['💃', '🪔', '✨'], motion: 'drift', density: 12 } },
  { id: 'dussehra', name: 'Dussehra', greeting: 'Happy Dussehra', emoji: '🏹', colors: ['#ef4444', '#facc15', '#fb923c'], windows: [[10, 19, 10, 20]], when: 'Oct 19–20 (2026)', fx: 'Bows and marigolds drifting over crimson', backdrop: { p: ['🏹', '🌼', '✨'], motion: 'drift', density: 11 } },
  { id: 'halloween', name: 'Halloween', greeting: 'Happy Halloween', emoji: '🎃', colors: ['#ff7a1a', '#a855f7', '#22c55e', '#000000'], windows: [[10, 31, 10, 31]], when: 'Oct 31', fx: 'Pumpkins and bats drifting through purple fog', backdrop: { p: ['🎃', '🦇', '👻'], motion: 'drift', density: 11 } },
  { id: 'apformation', name: 'Andhra Pradesh Formation Day', greeting: 'Happy Andhra Pradesh Formation Day', emoji: '🌾', colors: ['#16a34a', '#facc15', '#ffffff'], windows: [[11, 1, 11, 1]], when: 'Nov 1', fx: 'Paddy and marigolds drifting on green', backdrop: { p: ['🌾', '🌼', '✨'], motion: 'drift', density: 10 } },
  { id: 'diwali', name: 'Diwali (Dhanteras → Bhai Dooj)', greeting: 'Happy Diwali', emoji: '🪔', colors: ['#facc15', '#fb923c', '#ef4444', '#a855f7'], windows: [[11, 6, 11, 10]], when: 'Nov 6–10 (2026)', fx: 'Diyas and fireworks rising into a violet night', backdrop: { p: ['🪔', '✨', '🎆'], motion: 'rise', density: 16 } },
  { id: 'nagula', name: 'Nagula Chavithi', greeting: 'Nagula Chavithi Subhakankshalu', emoji: '🐍', colors: ['#4ade80', '#eab308', '#a3e635'], windows: [[11, 13, 11, 14]], when: 'Nov 13–14 (2026)', fx: 'Marigolds and leaves falling', backdrop: { p: ['🌼', '🐍', '🌿'], motion: 'fall', density: 10 } },
  { id: 'childrens', name: "Children's Day", greeting: 'Happy Children’s Day', emoji: '🎈', colors: ['#f43f5e', '#facc15', '#22d3ee', '#22c55e'], windows: [], when: 'Nov 14 · overlaps Nagula Chavithi, force from the console', fx: 'Balloons and candy rising', backdrop: { p: ['🎈', '🍭', '🎈'], motion: 'rise', density: 14 } },
  { id: 'chhath', name: 'Chhath Puja', greeting: 'Happy Chhath Puja', emoji: '🌅', colors: ['#fdba74', '#fb923c', '#60a5fa', '#ffffff'], windows: [[11, 15, 11, 16]], when: 'Nov 15–16 (2026)', fx: 'A dawn river: peach light over blue water', backdrop: { p: ['🌅', '🪔', '✨'], motion: 'rise', density: 9 } },
  // Force-only via the admin Festival Themes panel (month-long observance —
  // no auto window so it never self-activates).
  { id: 'karthika', name: 'Karthika Masam', greeting: 'Karthika Masam Subhakankshalu', emoji: '🪔', colors: ['#f59e0b', '#fb923c', '#fde047'], windows: [], when: 'Nov–Dec (month-long) · force from the console', fx: 'Rows of lamps rising into a warm dusk', backdrop: { p: ['🪔', '🪔', '✨'], motion: 'rise', density: 14 } },
  { id: 'gurunanak', name: 'Guru Nanak Jayanti', greeting: 'Happy Guru Nanak Jayanti', emoji: '🪯', colors: ['#f59e0b', '#1e3a8a', '#ffffff'], windows: [[11, 24, 11, 24]], when: 'Nov 24 (2026)', fx: 'Saffron light over deep blue, lamps rising', backdrop: { p: ['🪔', '🪯', '✨'], motion: 'rise', density: 10 } },
  { id: 'vaikunta', name: 'Vaikunta Ekadasi', greeting: 'Vaikunta Ekadasi Subhakankshalu', emoji: '🛕', colors: ['#fbbf24', '#a78bfa', '#fef3c7'], windows: [[12, 19, 12, 20]], when: 'Dec 19–20 (2026)', fx: 'Temple gopuram and lotuses rising at dawn', backdrop: { p: ['🪷', '✨', '🛕'], motion: 'rise', density: 11 } },
  { id: 'christmas', name: 'Christmas', greeting: 'Merry Christmas', emoji: '🎄', colors: ['#ef4444', '#22c55e', '#ffffff', '#facc15'], windows: [[12, 24, 12, 25]], when: 'Dec 24–25', fx: 'Snow falling over a deep pine green', backdrop: { p: ['❄️', '❄️', '✨'], motion: 'fall', density: 18 } },
  { id: 'newyear', name: 'New Year', greeting: 'Happy New Year', emoji: '🎆', colors: ['#facc15', '#22d3ee', '#a855f7', '#fb7185'], windows: [[12, 31, 12, 31], [1, 1, 1, 1]], when: 'Dec 31 – Jan 1', fx: 'Fireworks and confetti rising at midnight', backdrop: { p: ['🎆', '🎇', '✨'], motion: 'rise', density: 15 } },
];

export function festivalById(id: string | null | undefined): Festival | null {
  if (!id) return null;
  return FESTIVALS.find((f) => f.id === id) ?? null;
}

/** The html class a festival's skin keys on (Independence keeps its legacy `ind`). */
export function festivalClass(id: string): string {
  return `fest-${id === 'independence' ? 'ind' : id}`;
}

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

/** The next festival on the calendar after `date` (wrapping into next year), with days until it. */
export function nextFestival(date = new Date()): { festival: Festival; inDays: number } | null {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (let i = 1; i <= 366; i++) {
    const day = new Date(start.getTime() + i * 86_400_000);
    const f = activeFestival(day);
    if (f) return { festival: f, inDays: i };
  }
  return null;
}

/**
 * Theme window (owner request): each festival's SKIN applies from the day
 * BEFORE its calendar window through its last day, then the app reverts to
 * the normal theme the morning after. The splash/greeting keeps using
 * activeFestival (real window only) — this wider check drives only the
 * fest-<id> CSS class. The pre-paint table in index.html is generated from
 * the same data (`npm run gen:festivals`).
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
