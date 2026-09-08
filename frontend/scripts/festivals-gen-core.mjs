// Pure generator: FESTIVALS + FESTIVAL_THEMES data → the three artefacts the
// app ships (skin CSS, boot pre-paint window table, admin picker data).
// No I/O here so the unit test can run it in-memory and diff against disk.

/* ---------- colour math ---------- */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}
export function hslToRgb([h, s, l]) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
export function contrastOnWhite(rgb) {
  const lum = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return 1.05 / (L + 0.05);
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const trip = (rgb) => rgb.join(' ');
const hsl = (h, s, l) => trip(hslToRgb([h, clamp(s, 0, 100), clamp(l, 0, 100)]));
const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(', ')}, ${a})`;

/** Accent ramp for the dark UI: 500 is the accent (lightness pinned to a
 *  readable band), 300/400 lighter, 600 deeper. Light UI ramp is darkened so
 *  every step passes AA on white. Returns rgb triplets. */
export function ramps(accentHex) {
  const [h, s0] = rgbToHsl(hexToRgb(accentHex));
  const l0 = rgbToHsl(hexToRgb(accentHex))[2];
  const mono = s0 < 12;
  const s = mono ? s0 : Math.max(s0, 60);
  const l500 = clamp(l0, 52, 64);
  const dark = { 300: hsl(h, s, Math.min(88, l500 + 22)), 400: hsl(h, s, l500 + 10), 500: hsl(h, s, l500), 600: hsl(h, s, l500 - 12) };
  const sl = mono ? s0 : Math.min(100, s + 8);
  // Light UI: walk the lightness down until the 300 step clears AA (4.5:1) on
  // white — yellows and greens need to go much darker than reds and blues —
  // then step the rest of the ramp below it.
  let l300 = 40;
  while (l300 > 10 && contrastOnWhite(hslToRgb([h, sl, l300])) < 4.5) l300 -= 1;
  const light = { 300: hsl(h, sl, l300), 400: hsl(h, sl, l300 - 5), 500: hsl(h, sl, l300 - 10), 600: hsl(h, sl, l300 - 16) };
  return { dark, light, hue: h };
}

/** Page canvas tint: the ink scale nudged toward a hue so each festival owns
 *  its own mood (violet night, pine, dawn blue). Subtle on purpose — text
 *  contrast on ink-900/800 stays where the base theme puts it. */
export function canvas(hue, sat = 1) {
  return {
    dark: { 950: hsl(hue, 40 * sat, 3), 900: hsl(hue, 32 * sat, 7.5), 850: hsl(hue, 28 * sat, 9.5), 800: hsl(hue, 22 * sat, 15.5) },
    light: { 950: hsl(hue, 70 * sat, 99), 900: hsl(hue, 55 * sat, 97), 850: hsl(hue, 45 * sat, 95), 800: hsl(hue, 35 * sat, 91) },
  };
}

export function glowCss(shape, g) {
  const [a, b, c] = [g[0], g[1] ?? g[0], g[2]];
  switch (shape) {
    case 'sunrise':
      return `radial-gradient(56% 42% at 50% 100%, ${rgba(a, 0.2)}, transparent 66%), radial-gradient(40% 30% at 18% 0%, ${rgba(b, 0.1)}, transparent 58%)` + (c ? `, radial-gradient(40% 30% at 82% 0%, ${rgba(c, 0.1)}, transparent 58%)` : '');
    case 'corners':
      return `radial-gradient(40% 32% at 10% 8%, ${rgba(a, 0.15)}, transparent 60%), radial-gradient(38% 30% at 90% 14%, ${rgba(b, 0.13)}, transparent 60%), radial-gradient(44% 34% at 50% 100%, ${rgba(c ?? a, 0.11)}, transparent 62%)`;
    case 'sides':
      return `radial-gradient(38% 60% at 0% 50%, ${rgba(a, 0.15)}, transparent 62%), radial-gradient(38% 60% at 100% 50%, ${rgba(b, 0.13)}, transparent 62%)` + (c ? `, radial-gradient(44% 34% at 50% 100%, ${rgba(c, 0.1)}, transparent 62%)` : '');
    case 'center':
      return `radial-gradient(60% 48% at 50% 50%, ${rgba(a, 0.12)}, transparent 66%), radial-gradient(40% 30% at 50% 100%, ${rgba(b, 0.1)}, transparent 60%)`;
    default: // sky
      return `radial-gradient(52% 38% at 50% 0%, ${rgba(a, 0.16)}, transparent 62%), radial-gradient(44% 32% at 50% 100%, ${rgba(b, 0.1)}, transparent 60%)` + (c ? `, radial-gradient(36% 28% at 85% 40%, ${rgba(c, 0.08)}, transparent 58%)` : '');
  }
}

export function ribbonCss(stops) {
  const n = stops.length;
  if (n === 1) return stops[0];
  const parts = stops.map((s, i) => `${s} ${((i / n) * 100).toFixed(1)}% ${(((i + 1) / n) * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

const A = 'rgb(var(--ember-500) / 0.09)';
const A2 = 'rgb(var(--ember-500) / 0.2)';
const W = 'rgb(255 255 255 / 0.16)';
export function motifCss(motif, ribbon) {
  const c = (i, a) => rgba(ribbon[i % ribbon.length], a);
  switch (motif) {
    case 'dots': return { image: `radial-gradient(circle, ${A} 1.5px, transparent 2.2px)`, size: '26px 26px' };
    case 'rangoli': return { image: `radial-gradient(circle, transparent 0 30%, ${A} 30% 32%, transparent 32% 44%, ${A} 44% 46%, transparent 46% 58%, ${A} 58% 60%, transparent 60%)`, size: '180px 180px' };
    case 'rings': return { image: `repeating-radial-gradient(circle at 50% 50%, ${A} 0 1px, transparent 1px 26px)`, size: '260px 260px' };
    case 'diamonds': return { image: `repeating-linear-gradient(45deg, ${A} 0 1px, transparent 1px 24px), repeating-linear-gradient(-45deg, ${A} 0 1px, transparent 1px 24px)`, size: 'auto' };
    case 'stripes': return { image: `repeating-linear-gradient(-32deg, ${A} 0 2px, transparent 2px 28px)`, size: 'auto' };
    case 'grid': return { image: `linear-gradient(${A} 1px, transparent 1px), linear-gradient(90deg, ${A} 1px, transparent 1px)`, size: '40px 40px' };
    case 'stars': return { image: `radial-gradient(circle, ${W} 0 1px, transparent 1.6px), radial-gradient(circle, ${A} 0 1.4px, transparent 2px)`, size: '70px 70px, 110px 110px', pos: '0 0, 35px 50px' };
    case 'waves': return { image: `repeating-radial-gradient(circle at 50% 130%, transparent 0 20px, ${A} 20px 21.5px)`, size: '140px 70px' };
    case 'lanterns': return { image: `repeating-linear-gradient(90deg, transparent 0 46px, ${A} 46px 47px), radial-gradient(circle, ${A} 0 3px, transparent 4px)`, size: 'auto, 47px 60px', pos: '0 0, 23px 20px' };
    case 'petals': return { image: `radial-gradient(ellipse 38% 58% at 50% 50%, ${A} 0 55%, transparent 60%)`, size: '46px 64px' };
    case 'confetti': return { image: `radial-gradient(circle at 20% 30%, ${c(0, 0.16)} 0 2px, transparent 3px), radial-gradient(circle at 70% 60%, ${c(1, 0.16)} 0 2px, transparent 3px), radial-gradient(circle at 45% 88%, ${c(2, 0.16)} 0 1.6px, transparent 2.6px)`, size: '96px 96px' };
    case 'snow': return { image: `radial-gradient(circle, ${W} 0 2px, transparent 3px), radial-gradient(circle, rgb(255 255 255 / 0.1) 0 3px, transparent 4.5px)`, size: '54px 54px, 120px 120px', pos: '0 0, 30px 40px' };
    case 'lamps': return { image: `radial-gradient(circle at 50% 50%, ${A2} 0 3.5px, transparent 6px)`, size: '52px 52px', pos: 'center bottom 5%', repeat: 'repeat-x' };
    default: return null;
  }
}

export const festClass = (id) => `fest-${id === 'independence' ? 'ind' : id}`;
const cssStr = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/* ---------- artefact 1: skin CSS ---------- */
export function buildCss(festivals, themes) {
  const out = [];
  out.push(`/* GENERATED by scripts/gen-festivals.mjs from src/constants/festivals.ts + festivalThemes.ts.
   Do not edit by hand — run \`npm run gen:festivals\`. One full theme per festival:
   accent ramp (dark + AA light), tinted canvas, top ribbon, ambient glow, motif, badge. */

/* Shared plumbing: every skin paints through these variables. The html canvas
   follows the tinted ink-900 (inline theme background is overridden on purpose)
   and the body goes transparent so the sky layer (z -5) shows behind content. */
html[class*='fest-'] { background: rgb(var(--ink-900)) !important; }
html[class*='fest-'] body { background: transparent; }
html[class*='fest-'] body::after { background: var(--fest-ribbon); }
html[class*='fest-'] .fest-sky::before { background: var(--fest-glow); }
html[class*='fest-'] .fest-sky::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--fest-motif, none);
  background-size: var(--fest-motif-size, auto);
  background-position: var(--fest-motif-pos, 0 0);
  background-repeat: var(--fest-motif-repeat, repeat);
}
html.light[class*='fest-'] .fest-sky::after { opacity: 0.8; }
html[class*='fest-']:not(.fest-ind) .vx-brand::after {
  font-size: 12px;
  line-height: 1;
  margin-left: 3px;
  flex-shrink: 0;
}
/* Black theme stays true black during festivals — the tint only touches the
   glow and motif, never the canvas. */
html.amoled[class*='fest-'] { --ink-950: 0 0 0; --ink-900: 3 3 5; --ink-850: 8 8 11; --ink-800: 16 17 22; }
`);
  for (const f of festivals) {
    const t = themes[f.id];
    if (!t) throw new Error(`festivalThemes.ts has no entry for "${f.id}"`);
    const cls = festClass(f.id);
    const r = ramps(t.accent);
    const cv = canvas(t.canvasHue ?? r.hue, t.canvasSat ?? 1);
    const m = motifCss(t.motif, t.ribbon);
    const vars = [
      `--ember-300: ${r.dark[300]}; --ember-400: ${r.dark[400]}; --ember-500: ${r.dark[500]}; --ember-600: ${r.dark[600]};`,
      `--ink-950: ${cv.dark[950]}; --ink-900: ${cv.dark[900]}; --ink-850: ${cv.dark[850]}; --ink-800: ${cv.dark[800]};`,
      `--fest-ribbon: ${ribbonCss(t.ribbon)};`,
      `--fest-glow: ${glowCss(t.glowShape, t.glow)};`,
      m ? `--fest-motif: ${m.image}; --fest-motif-size: ${m.size};${m.pos ? ` --fest-motif-pos: ${m.pos};` : ''}${m.repeat ? ` --fest-motif-repeat: ${m.repeat};` : ''}` : '--fest-motif: none;',
    ];
    out.push(`/* ${f.emoji} ${f.name} — ${f.when} */`);
    out.push(`html.${cls} {\n  ${vars.join('\n  ')}\n}`);
    out.push(`html.${cls}.light {\n  --ember-300: ${r.light[300]}; --ember-400: ${r.light[400]}; --ember-500: ${r.light[500]}; --ember-600: ${r.light[600]};\n  --ink-950: ${cv.light[950]}; --ink-900: ${cv.light[900]}; --ink-850: ${cv.light[850]}; --ink-800: ${cv.light[800]};\n}`);
    if (t.badge) out.push(`html.${cls} .vx-brand::after { content: ${cssStr(t.badge)} / ''; }`);
    out.push('');
  }
  return out.join('\n');
}

/* ---------- artefact 2: boot pre-paint window table ---------- */
const enc = (m, d) => m * 100 + d;
function dayBefore(m, d) {
  const dt = new Date(2026, m - 1, d - 1); // 2026 is not a leap year, matching the lunar tables
  return [dt.getMonth() + 1, dt.getDate()];
}
/** Entries as [from, to, class-suffix]. Real windows first (they win the
 *  first-match loop), then each window's theme-ahead day. */
export function buildWindowTable(festivals) {
  const real = [];
  const ahead = [];
  for (const f of festivals) {
    const key = festClass(f.id).slice(5);
    for (const [mf, df, mt, dt] of f.windows) {
      real.push([enc(mf, df), enc(mt, dt), key]);
      const [am, ad] = dayBefore(mf, df);
      if (enc(am, ad) < enc(mf, df)) ahead.push([enc(am, ad), enc(am, ad), key]);
    }
  }
  return real.concat(ahead);
}
export function buildWindowJs(festivals) {
  const rows = buildWindowTable(festivals).map(([a, b, k]) => `[${a}, ${b}, '${k}']`);
  const lines = [];
  for (let i = 0; i < rows.length; i += 6) lines.push('          ' + rows.slice(i, i + 6).join(', '));
  return `var FW = [\n${lines.join(',\n')}];`;
}
export const FW_RE = /var FW = \[[\s\S]*?\];/;

/* ---------- artefact 3: admin picker data ---------- */
export function buildAdminJs(festivals, themes) {
  const rows = festivals.map((f) => {
    const t = themes[f.id];
    const r = ramps(t.accent);
    const cv = canvas(t.canvasHue ?? r.hue, t.canvasSat ?? 1);
    return {
      id: f.id, name: f.name, emoji: f.emoji, when: f.when, fx: f.fx, greeting: f.greeting,
      win: f.windows.map(([mf, df, mt, dt]) => [enc(mf, df), enc(mt, dt)]),
      colors: f.colors, accent: `rgb(${r.dark[500]})`, canvas: `rgb(${cv.dark[900]})`, ribbon: ribbonCss(t.ribbon),
      motif: t.motif, badge: t.badge || '', forceOnly: f.windows.length === 0,
    };
  });
  return `// GENERATED by scripts/gen-festivals.mjs — the app's festival calendar + skins. Do not edit.\nwindow.VX_FESTIVALS = ${JSON.stringify(rows)};\n`;
}
