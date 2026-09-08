/**
 * Per-festival visual skin (5.14.0). One entry per FESTIVALS id.
 *
 * The generator (`scripts/gen-festivals.mjs`) turns each entry into a full
 * `html.fest-<id>` theme: the accent ramp (dark + AA-safe light), a tinted
 * page canvas, the 3px top ribbon, an ambient glow, a CSS-drawn motif layer
 * behind content, and the badge beside the brand. Nothing here is read at
 * runtime — the app ships the generated CSS, so there is zero JS cost.
 *
 * Every festival is meant to FEEL different: pick a distinct accent hue, a
 * canvas hue that sets the mood (Diwali = violet night, Christmas = pine,
 * Chhath = dawn blue), a motif that belongs to the day, and a glow shape.
 */
export type FestivalMotif =
  | 'dots' | 'rangoli' | 'rings' | 'diamonds' | 'stripes' | 'grid' | 'stars'
  | 'waves' | 'lanterns' | 'petals' | 'confetti' | 'snow' | 'lamps' | 'none';

export type GlowShape = 'sky' | 'sunrise' | 'corners' | 'sides' | 'center';

export interface FestivalTheme {
  /** Primary accent as hex; the 300/400/500/600 ramps are derived. */
  accent: string;
  /** Hue (0-360) that tints the page canvas; defaults to the accent's hue. */
  canvasHue?: number;
  /** Canvas saturation multiplier (0-1); 0 keeps the canvas neutral grey. */
  canvasSat?: number;
  /** Glow colours (hex) — two or three, painted per `glowShape`. */
  glow: string[];
  /** Where the glow sits. */
  glowShape: GlowShape;
  /** Top ribbon stops (hex), left to right. */
  ribbon: string[];
  /** CSS-drawn motif behind content. */
  motif: FestivalMotif;
  /** Emoji beside the brand; omit to keep the logo clean. */
  badge?: string;
}

export const FESTIVAL_THEMES: Record<string, FestivalTheme> = {
  sankranti: { accent: '#f59e0b', canvasHue: 38, glow: ['#f59e0b', '#22c55e'], glowShape: 'sunrise', ribbon: ['#f59e0b', '#fde047', '#fb923c', '#22c55e'], motif: 'diamonds', badge: '🪁' },
  republic: { accent: '#ff9933', canvasHue: 222, canvasSat: 0.8, glow: ['#ff9933', '#138808', '#3b82f6'], glowShape: 'sides', ribbon: ['#ff9933', '#ffffff', '#138808'], motif: 'rings', badge: '🇮🇳' },
  valentine: { accent: '#f43f5e', canvasHue: 345, glow: ['#f43f5e', '#fb7185'], glowShape: 'center', ribbon: ['#f43f5e', '#fb7185', '#fda4af'], motif: 'petals', badge: '💗' },
  shivaratri: { accent: '#60a5fa', canvasHue: 225, glow: ['#60a5fa', '#1e3a8a'], glowShape: 'sky', ribbon: ['#94a3b8', '#60a5fa', '#1e3a8a'], motif: 'stars', badge: '🔱' },
  holi: { accent: '#d946ef', canvasHue: 290, glow: ['#ec4899', '#22d3ee', '#facc15'], glowShape: 'corners', ribbon: ['#ec4899', '#a855f7', '#22d3ee', '#facc15', '#22c55e'], motif: 'confetti', badge: '🎨' },
  womensday: { accent: '#9333ea', canvasHue: 275, glow: ['#a855f7', '#f0abfc'], glowShape: 'sky', ribbon: ['#a855f7', '#c084fc', '#f0abfc'], motif: 'petals', badge: '💜' },
  ugadi: { accent: '#a3e635', canvasHue: 78, glow: ['#84cc16', '#fb923c'], glowShape: 'sunrise', ribbon: ['#65a30d', '#facc15', '#ca8a04'], motif: 'petals', badge: '🥭' },
  eid: { accent: '#34d399', canvasHue: 160, glow: ['#fde047', '#10b981'], glowShape: 'sky', ribbon: ['#22c55e', '#fde047', '#ffffff'], motif: 'stars', badge: '🌙' },
  ramanavami: { accent: '#f97316', canvasHue: 26, glow: ['#fb923c', '#facc15'], glowShape: 'sky', ribbon: ['#f97316', '#facc15', '#fef3c7'], motif: 'rangoli', badge: '🚩' },
  easter: { accent: '#a78bfa', canvasHue: 262, canvasSat: 0.7, glow: ['#a78bfa', '#f9a8d4'], glowShape: 'corners', ribbon: ['#a78bfa', '#f9a8d4', '#fde047'], motif: 'petals', badge: '🐣' },
  vishu: { accent: '#fbbf24', canvasHue: 46, glow: ['#fbbf24', '#65a30d'], glowShape: 'sunrise', ribbon: ['#fbbf24', '#fde68a', '#65a30d'], motif: 'dots', badge: '🌾' },
  akshaya: { accent: '#eab308', canvasHue: 44, glow: ['#eab308', '#fde047'], glowShape: 'center', ribbon: ['#eab308', '#fde047', '#fef9c3'], motif: 'diamonds', badge: '🪙' },
  buddha: { accent: '#d4a017', canvasHue: 42, canvasSat: 0.5, glow: ['#fde68a', '#fb923c'], glowShape: 'center', ribbon: ['#d4a017', '#fde68a', '#ffffff'], motif: 'rings', badge: '☸️' },
  mothersday: { accent: '#f472b6', canvasHue: 335, glow: ['#f472b6', '#fbcfe8'], glowShape: 'sky', ribbon: ['#f472b6', '#f9a8d4', '#fbcfe8'], motif: 'petals', badge: '💐' },
  hanuman: { accent: '#ea580c', canvasHue: 16, glow: ['#ea580c', '#dc2626'], glowShape: 'sunrise', ribbon: ['#ea580c', '#f59e0b', '#fde047'], motif: 'stripes', badge: '🌺' },
  bakrid: { accent: '#10b981', canvasHue: 170, glow: ['#10b981', '#fde047'], glowShape: 'sides', ribbon: ['#10b981', '#6ee7b7', '#fde047'], motif: 'lanterns', badge: '🕌' },
  telangana: { accent: '#ec4899', canvasHue: 340, glow: ['#ec4899', '#22c55e'], glowShape: 'sides', ribbon: ['#ec4899', '#ffffff', '#22c55e'], motif: 'stripes', badge: '🏛️' },
  fathersday: { accent: '#2563eb', canvasHue: 222, glow: ['#2563eb', '#60a5fa'], glowShape: 'sky', ribbon: ['#2563eb', '#60a5fa', '#bfdbfe'], motif: 'grid', badge: '👔' },
  bonalu: { accent: '#facc15', canvasHue: 52, glow: ['#facc15', '#dc2626'], glowShape: 'corners', ribbon: ['#facc15', '#dc2626', '#22c55e'], motif: 'rangoli', badge: '🏺' },
  gurupurnima: { accent: '#d97706', canvasHue: 34, canvasSat: 0.6, glow: ['#f59e0b', '#fde68a'], glowShape: 'center', ribbon: ['#b45309', '#f59e0b', '#fde68a'], motif: 'rings', badge: '📿' },
  friendship: { accent: '#06b6d4', canvasHue: 192, glow: ['#06b6d4', '#facc15', '#f472b6'], glowShape: 'corners', ribbon: ['#06b6d4', '#facc15', '#f472b6'], motif: 'confetti', badge: '🤝' },
  independence: { accent: '#ff9933', canvasHue: 30, canvasSat: 0.7, glow: ['#ff9933', '#138808'], glowShape: 'sides', ribbon: ['#ff9933', '#ffffff', '#138808'], motif: 'none' },
  varalakshmi: { accent: '#f9a8d4', canvasHue: 328, glow: ['#f472b6', '#f59e0b'], glowShape: 'sky', ribbon: ['#f9a8d4', '#f59e0b', '#fde047'], motif: 'petals', badge: '🪷' },
  onam: { accent: '#65a30d', canvasHue: 92, glow: ['#facc15', '#22c55e'], glowShape: 'sunrise', ribbon: ['#facc15', '#fb923c', '#22c55e', '#ffffff'], motif: 'rangoli', badge: '🌼' },
  rakhi: { accent: '#fb7185', canvasHue: 350, glow: ['#fb7185', '#facc15'], glowShape: 'sides', ribbon: ['#fb7185', '#facc15', '#fda4af'], motif: 'stripes', badge: '🎀' },
  janmashtami: { accent: '#0891b2', canvasHue: 192, glow: ['#0ea5e9', '#a855f7'], glowShape: 'corners', ribbon: ['#0891b2', '#fde047', '#a855f7'], motif: 'waves', badge: '🦚' },
  teachers: { accent: '#6366f1', canvasHue: 240, glow: ['#6366f1', '#fde047'], glowShape: 'sky', ribbon: ['#6366f1', '#a5b4fc', '#fde047'], motif: 'grid', badge: '📚' },
  ganesh: { accent: '#fb923c', canvasHue: 24, glow: ['#fb7d3e', '#ef4444', '#facc15'], glowShape: 'sky', ribbon: ['#fb923c', '#ef4444', '#facc15'], motif: 'dots', badge: '🐘' },
  gandhi: { accent: '#a3a3a3', canvasHue: 0, canvasSat: 0, glow: ['#f97316', '#22c55e'], glowShape: 'sides', ribbon: ['#f97316', '#ffffff', '#22c55e'], motif: 'rings', badge: '🕊️' },
  bathukamma: { accent: '#e879f9', canvasHue: 296, glow: ['#e879f9', '#f59e0b', '#22c55e'], glowShape: 'corners', ribbon: ['#e879f9', '#f59e0b', '#facc15', '#22c55e'], motif: 'rangoli', badge: '🌸' },
  navratri: { accent: '#dc2626', canvasHue: 355, glow: ['#dc2626', '#facc15', '#a855f7'], glowShape: 'corners', ribbon: ['#dc2626', '#facc15', '#22c55e', '#a855f7'], motif: 'diamonds', badge: '💃' },
  dussehra: { accent: '#ef4444', canvasHue: 2, glow: ['#ef4444', '#facc15'], glowShape: 'sky', ribbon: ['#ef4444', '#facc15', '#fb923c'], motif: 'diamonds', badge: '🏹' },
  halloween: { accent: '#ff7a1a', canvasHue: 262, canvasSat: 0.9, glow: ['#ff7a1a', '#a855f7'], glowShape: 'sunrise', ribbon: ['#ff7a1a', '#a855f7', '#22c55e'], motif: 'waves', badge: '🎃' },
  apformation: { accent: '#16a34a', canvasHue: 134, glow: ['#16a34a', '#facc15'], glowShape: 'sides', ribbon: ['#16a34a', '#facc15', '#ffffff'], motif: 'stripes', badge: '🌾' },
  diwali: { accent: '#facc15', canvasHue: 272, canvasSat: 1, glow: ['#f59e0b', '#a855f7', '#ef4444'], glowShape: 'sunrise', ribbon: ['#facc15', '#fb923c', '#ef4444', '#a855f7'], motif: 'lamps', badge: '🪔' },
  nagula: { accent: '#4ade80', canvasHue: 150, glow: ['#4ade80', '#eab308'], glowShape: 'sky', ribbon: ['#22c55e', '#a3e635', '#eab308'], motif: 'waves', badge: '🐍' },
  childrens: { accent: '#f43f5e', canvasHue: 200, canvasSat: 0.6, glow: ['#f43f5e', '#22d3ee', '#facc15'], glowShape: 'corners', ribbon: ['#f43f5e', '#facc15', '#22d3ee', '#22c55e'], motif: 'confetti', badge: '🎈' },
  chhath: { accent: '#fdba74', canvasHue: 212, canvasSat: 0.8, glow: ['#fb923c', '#60a5fa'], glowShape: 'sunrise', ribbon: ['#fdba74', '#fb923c', '#60a5fa'], motif: 'waves', badge: '🌅' },
  karthika: { accent: '#f59e0b', canvasHue: 22, canvasSat: 0.9, glow: ['#d97706', '#78350f'], glowShape: 'sunrise', ribbon: ['#f59e0b', '#c2410c'], motif: 'lamps', badge: '🪔' },
  gurunanak: { accent: '#f59e0b', canvasHue: 224, canvasSat: 0.8, glow: ['#f59e0b', '#1e3a8a'], glowShape: 'sky', ribbon: ['#f59e0b', '#1e3a8a', '#ffffff'], motif: 'rings', badge: '🪯' },
  vaikunta: { accent: '#fbbf24', canvasHue: 258, canvasSat: 0.7, glow: ['#fbbf24', '#a78bfa'], glowShape: 'sky', ribbon: ['#fbbf24', '#a78bfa', '#fef3c7'], motif: 'lanterns', badge: '🛕' },
  christmas: { accent: '#dc2626', canvasHue: 152, canvasSat: 0.9, glow: ['#60a5fa', '#f43f5e', '#22c55e'], glowShape: 'corners', ribbon: ['#ef4444', '#22c55e', '#ffffff'], motif: 'snow', badge: '🎄' },
  newyear: { accent: '#c084fc', canvasHue: 242, glow: ['#22d3ee', '#a855f7', '#fb7185'], glowShape: 'corners', ribbon: ['#22d3ee', '#a855f7', '#fb7185'], motif: 'confetti', badge: '🎆' },
};
