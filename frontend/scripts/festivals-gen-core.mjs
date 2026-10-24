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
  // Light UI: walk the lightness down until the 300 step clears 5:1 on white
  // (so it still clears AA 4.5:1 on the tinted light canvas) — yellows and greens need to go much darker than reds and blues —
  // then step the rest of the ramp below it.
  let l300 = 40;
  while (l300 > 10 && contrastOnWhite(hslToRgb([h, sl, l300])) < 5) l300 -= 1;
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

/* Photo-led festival art. Keep this small, stable map in the generator so
 * generated admin data and runtime CSS always point at the same real images. */
/** Emblem colours 2 and 3 come from the ribbon; in the light theme a colour too
 *  pale to read on the light canvas is darkened (white becomes slate). */
export function emblemColours(t) {
  const pick = (i) => t.ribbon[i] ?? t.glow[i - 1] ?? t.accent;
  const lightSafe = (hex) => {
    const [h, sat, l] = rgbToHsl(hexToRgb(hex));
    if (contrastOnWhite(hexToRgb(hex)) >= 2) return trip(hexToRgb(hex));
    if (sat < 12) return '100 116 139';
    let li = Math.min(l, 46);
    while (li > 20 && contrastOnWhite(hslToRgb([h, sat, li])) < 2.2) li -= 1;
    return hsl(h, sat, li);
  };
  return { dark: [trip(hexToRgb(pick(1))), trip(hexToRgb(pick(2)))], light: [lightSafe(pick(1)), lightSafe(pick(2))], hex: [t.accent, pick(1), pick(2)] };
}

export function buildCss(festivals, themes) {
  const out = [];
  out.push(`/* GENERATED by scripts/gen-festivals.mjs from src/constants/festivals.ts + festivalThemes.ts.
   Do not edit by hand — run \`npm run gen:festivals\`. One skin per festival:
   accent ramp (dark + AA light), tinted canvas, and one ambient layer (glow +
   drawn emblem watermark + quiet motif + particles + the day's own set piece).
   Drawn art only: nothing in this file loads from another host.

   11.6.0 — there is no band across the top of the app. The skin used to draw a
   3px ribbon there, which read as a stray browser line above the content
   rather than as part of the day; the festival now lives entirely in the
   backdrop. The ribbon COLOURS stay in festivalThemes.ts: they still pick the
   emblem and particle colours, and the owner console still shows them as each
   festival's swatch. */

/* Shared plumbing. The html canvas follows the tinted ink-900 and the body goes
   transparent so the ambient layer (z -5) shows behind content. */
html[class*='fest-'] { background: rgb(var(--ink-900)) !important; }
html[class*='fest-'] body { background: transparent; }
/* The shell and the page panel are opaque in every app style, which would bury
   the ambient layer. During a festival they turn into veils: clear on a phone
   (the page is the whole screen), lightly tinted on wide screens so the page
   panel still reads against the gutters. */
html[class*='fest-'] .vx-shell { background: transparent !important; }
html[class*='fest-'] .vx-workspace { background: radial-gradient(760px 300px at 8% -120px, rgb(var(--ember-500) / var(--vx-mesh-ember, 0.1)), transparent 70%) local, transparent !important; }
@media (min-width: 768px) {
  html[class*='fest-'] .vx-shell { background: rgb(var(--ink-950) / 0.3) !important; }
  html.light[class*='fest-'] .vx-shell { background: rgb(var(--ink-800) / 0.3) !important; }
  html[class*='fest-'] .vx-workspace { background: radial-gradient(760px 300px at 8% -120px, rgb(var(--ember-500) / var(--vx-mesh-ember, 0.1)), transparent 70%) local, rgb(var(--ink-900) / 0.4) !important; }
}
/* Two app styles draw the phone tab bar as a see-through fade; over a festival
   backdrop the page text shows through the icons, so the bar firms up. */
html[class*='fest-']:is([data-template='verdant'], [data-template='verse']) .vx-dock { background-color: rgb(var(--ink-950) / 0.96); }
html[class*='fest-'] .fest-sky { position: fixed; inset: 0; z-index: -5; overflow: hidden; pointer-events: none; animation: festSkyIn 0.9s ease-out both; }
/* The glow breathes: a slow opacity swell, nothing else, so the backdrop is
   alive without anything moving across the reading area. */
html[class*='fest-'] .fest-sky::before { content: ''; position: absolute; inset: 0; background-image: var(--fest-glow); --fest-glow-o: 0.55; opacity: var(--fest-glow-o); animation: festBreathe 16s ease-in-out infinite; }
/* The motif drifts. It is inset past the viewport on every side so the drift
   is a transform (compositor-only) and never exposes an edge. */
html[class*='fest-'] .fest-sky::after { content: ''; position: absolute; inset: -9%; background-image: var(--fest-motif, none); background-size: var(--fest-motif-size, auto); background-position: var(--fest-motif-pos, 0 0); background-repeat: var(--fest-motif-repeat, repeat); opacity: 0.5; animation: festMotifDrift 54s ease-in-out infinite alternate; -webkit-mask-image: linear-gradient(180deg, #000, transparent 70%); mask-image: linear-gradient(180deg, #000, transparent 70%); }
/* The light skin is quieter. The swell is written as a multiple of this value
   so the keyframes follow the theme instead of overriding it. */
html.light[class*='fest-'] .fest-sky::before { --fest-glow-o: 0.4; }
html.light[class*='fest-'] .fest-sky::after { opacity: 0.6; }
/* Emblems: five classes, coloured from the skin. */
.fest-emblem { display: block; overflow: visible; }
.fest-emblem .a { fill: var(--fest-c1, rgb(var(--ember-400))); }
.fest-emblem .b { fill: var(--fest-c2, rgb(var(--ember-300))); }
.fest-emblem .c { fill: var(--fest-c3, rgb(var(--ember-600))); }
.fest-emblem .s, .fest-emblem .t { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.fest-emblem .s { stroke: var(--fest-c1, rgb(var(--ember-400))); }
.fest-emblem .t { stroke: var(--fest-c2, rgb(var(--ember-300))); }
/* The emblem watermark breathes with the sky: a slow lift and a degree of
   turn, far too slow to catch the eye while reading. */
.fest-sky .fest-wm { position: absolute; right: -7vmin; bottom: 9vmin; width: min(64vmin, 540px); height: auto; opacity: 0.075; transform: rotate(-8deg); animation: festWmFloat 22s ease-in-out infinite; }
html.light .fest-sky .fest-wm { opacity: 0.1; }
/* Particles: transform + opacity only. Each one sways as it travels — the
   keyframes carry the side-to-side and the tumble, so one animation on one
   element does the whole thing and the compositor handles it alone. The sway
   width comes from --fest-sway, set per particle, so no two share a path. */
.fest-p { position: absolute; top: 0; width: 1em; height: 1em; opacity: 0; background: var(--fest-c1, rgb(var(--ember-400))); --fest-sway: 16px; will-change: transform, opacity; }
.fest-p:nth-child(3n + 1) { background: var(--fest-c2, rgb(var(--ember-300))); }
.fest-p:nth-child(3n + 2) { background: var(--fest-c3, rgb(var(--ember-500))); }
.fest-p-rise { top: auto; bottom: -6%; animation: festRise linear infinite; }
.fest-p-fall { top: -6%; animation: festFall linear infinite; }
.fest-p-drift { animation: festDrift ease-in-out infinite alternate; }
.fest-p-alt { animation-direction: reverse; }
.fest-p-drift.fest-p-alt { animation-direction: alternate-reverse; }
.fest-p-powder, .fest-p-snow { border-radius: 50%; }
.fest-p-snow { background: rgb(var(--ink-100)) !important; width: 0.5em; height: 0.5em; }
.fest-p-petal { border-radius: 80% 0 80% 0; }
.fest-p-lantern { height: 1.35em; border-radius: 40% 40% 48% 48%; }
.fest-p-spark { width: 0.22em; border-radius: 999px; }
.fest-p-ribbon { height: 0.5em; border-radius: 999px 3px 999px 3px; }
.fest-p-leaf, .fest-p-feather { border-radius: 100% 0 100% 0; }
html.light .fest-particles { opacity: 0.6; }
/* ---- the day's own set piece ----------------------------------------------
   One per festival (the festivalVisuals.ts 'signature'), drawn with the skin's
   three colours so each day reads as itself and not as a generic effect:
   fireworks for the nights that end with them, lamps lit along the bottom for
   the festivals of light, colour clouds for Holi, a quiet sky of stars for the
   night-long vigils, and lanterns strung from the top for Eid. All of them are
   transform/opacity only, capped in FestBackdrop, paused with the tab, and
   never rendered under reduced motion or data saver. */
.fest-set { position: absolute; inset: 0; overflow: hidden; }
/* Fireworks: one point whose box-shadow is the spray of sparks, scaled out and
   faded. Two rings of sparks, so it opens rather than just growing. */
.fest-fw { position: absolute; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 50%; opacity: 0; will-change: transform, opacity; animation: festFw 4.6s ease-out infinite; box-shadow: 0px -38px 0 0 var(--fest-c1), 27px -27px 0 0 var(--fest-c2), 38px 0px 0 0 var(--fest-c3), 27px 27px 0 0 var(--fest-c1), 0px 38px 0 0 var(--fest-c2), -27px 27px 0 0 var(--fest-c3), -38px 0px 0 0 var(--fest-c1), -27px -27px 0 0 var(--fest-c2), 0px -64px 0 -1px var(--fest-c3), 45px -45px 0 -1px var(--fest-c1), 64px 0px 0 -1px var(--fest-c2), 45px 45px 0 -1px var(--fest-c3), 0px 64px 0 -1px var(--fest-c1), -45px 45px 0 -1px var(--fest-c2), -64px 0px 0 -1px var(--fest-c3), -45px -45px 0 -1px var(--fest-c1); }
@keyframes festFw { 0% { opacity: 0; transform: scale(0.1); } 6% { opacity: 1; } 50% { opacity: 0.65; } 100% { opacity: 0; transform: scale(1.75); } }
/* Lamps: a clay bowl, a flame that leans and gutters, and the pool of light it
   throws. The flame and the pool share one rhythm so they flicker together. */
.fest-diya { position: absolute; /* Clear of the player, using the shell's own measurement of it, so the row of lamps is not hidden behind the deck the moment anything plays. */ bottom: calc(var(--vx-player-h, 76px) + var(--vx-deck-gap, 10px) * 2 + 14px); width: 26px; height: 11px; margin-left: -13px; border-radius: 0 0 999px 999px; opacity: 0.55; background: linear-gradient(180deg, var(--fest-c3), rgb(0 0 0 / 0.45)); }
.fest-diya::before { content: ''; position: absolute; left: 50%; bottom: 9px; width: 9px; height: 15px; margin-left: -4.5px; border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%; background: radial-gradient(ellipse at 50% 82%, #fff6cc, var(--fest-c1) 55%, transparent 80%); transform-origin: 50% 100%; will-change: transform, opacity; animation: festFlame 1.9s ease-in-out infinite; }
.fest-diya::after { content: ''; position: absolute; left: 50%; bottom: 2px; width: 72px; height: 72px; margin-left: -36px; border-radius: 50%; background: radial-gradient(circle, var(--fest-c1) 0%, transparent 62%); animation: festFlameGlow 1.9s ease-in-out infinite; }
@keyframes festFlame { 0%, 100% { transform: scaleY(1) skewX(0deg); opacity: 0.95; } 30% { transform: scaleY(1.18) skewX(-6deg); opacity: 1; } 64% { transform: scaleY(0.88) skewX(5deg); opacity: 0.78; } }
@keyframes festFlameGlow { 0%, 100% { opacity: 0.16; } 40% { opacity: 0.3; } }
/* Holi: soft clouds of colour that bloom open and clear. */
.fest-bloom { position: absolute; width: 40vmin; height: 40vmin; margin: -20vmin 0 0 -20vmin; border-radius: 50%; opacity: 0; will-change: transform, opacity; background: radial-gradient(circle, var(--fest-c1) 0%, transparent 62%); animation: festBloom 7.5s ease-out infinite; }
.fest-bloom:nth-child(3n + 1) { background-image: radial-gradient(circle, var(--fest-c2) 0%, transparent 62%); }
.fest-bloom:nth-child(3n + 2) { background-image: radial-gradient(circle, var(--fest-c3) 0%, transparent 62%); }
@keyframes festBloom { 0% { opacity: 0; transform: scale(0.25); } 16% { opacity: 0.5; } 100% { opacity: 0; transform: scale(1.5); } }
/* Night vigils: a sky of stars coming and going out of step with each other. */
.fest-twinkle { position: absolute; width: 3px; height: 3px; margin: -1.5px 0 0 -1.5px; border-radius: 50%; opacity: 0; background: var(--fest-c2); box-shadow: 0 0 7px 1px var(--fest-c2); will-change: transform, opacity; animation: festTwinkle 4.2s ease-in-out infinite; }
@keyframes festTwinkle { 0%, 100% { opacity: 0; transform: scale(0.4); } 50% { opacity: 0.85; transform: scale(1); } }
/* Lanterns strung from above, swinging on their own cords. The cord length is
   per lantern (--fest-drop), and it is also the pivot the swing turns about. */
.fest-lamp { position: absolute; top: var(--fest-drop, 12vh); width: 20px; height: 28px; margin-left: -10px; border-radius: 42% 42% 46% 46%; opacity: 0.55; background: linear-gradient(180deg, var(--fest-c2), var(--fest-c1)); transform-origin: 50% calc(var(--fest-drop, 12vh) * -1); will-change: transform; animation: festSwing 6s ease-in-out infinite alternate; }
.fest-lamp::before { content: ''; position: absolute; left: 50%; bottom: 100%; width: 1px; height: var(--fest-drop, 12vh); background: rgb(var(--ink-100) / 0.22); }
.fest-lamp::after { content: ''; position: absolute; left: 50%; top: 100%; width: 5px; height: 7px; margin-left: -2.5px; border-radius: 0 0 3px 3px; background: var(--fest-c3); }
@keyframes festSwing { from { transform: rotate(-6deg); } to { transform: rotate(6deg); } }
html.light .fest-set { opacity: 0.75; }
/* A hidden tab costs nothing: every moving part inside the sky stops, including
   the glow and motif on the sky's own pseudo-elements and the flame and cord on
   each set piece's. Written as a sweep rather than a list so a set piece added
   later is covered without anyone remembering to come back here. */
.fest-sky.is-paused::before, .fest-sky.is-paused::after,
.fest-sky.is-paused *, .fest-sky.is-paused *::before, .fest-sky.is-paused *::after { animation-play-state: paused; }
/* National days: the flag in the air (Independence Day, Republic Day) with a
   slowly turning 24-spoke chakra, and tricolour balls rising on Independence
   Day. These are the flag's own colours, so they are literal on purpose. */
.fest-flag { position: absolute; top: 44%; left: 50%; width: min(74vw, 560px); aspect-ratio: 3 / 2; display: flex; opacity: 0.3; transform: translate(-50%, -50%) rotate(-5deg); animation: festSway 9s ease-in-out infinite; }
html.light .fest-flag { opacity: 0.4; }
.fest-flag i { flex: 1; background: linear-gradient(180deg, #ff9933 0 33.4%, #ffffff 33.4% 66.7%, #138808 66.7% 100%); animation: festWave 2.8s ease-in-out infinite; will-change: transform; }
html.light .fest-flag i { box-shadow: 0 -1px 0 rgb(0 0 0 / 0.16), 0 1px 0 rgb(0 0 0 / 0.16); }
.fest-chakra { position: absolute; left: 50%; top: 50%; width: 17%; color: #000080; transform: translate(-50%, -50%); animation: festSpin 36s linear infinite; }
.fest-ball { position: absolute; bottom: -70px; border-radius: 50%; opacity: 0; animation: festBall linear infinite; will-change: transform, opacity; }
.fest-ball.fb0 { background: radial-gradient(circle at 32% 28%, #ffcf9e, #ff9933 70%); }
.fest-ball.fb1 { background: radial-gradient(circle at 32% 28%, #ffffff, #d5dbe4 78%); }
.fest-ball.fb2 { background: radial-gradient(circle at 32% 28%, #8fd96b, #138808 72%); }
/* Greeting card (splash) */
.fest-splash { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 20px; background: rgb(var(--ink-950) / 0.6); animation: festFade 0.3s ease-out both; }
.fest-card { position: relative; width: min(100%, 400px); overflow: hidden; border-radius: 28px; padding: 30px 24px 18px; text-align: center; border: 1px solid rgb(var(--ink-100) / 0.1); box-shadow: 0 24px 80px rgb(0 0 0 / 0.4); animation: festCardIn 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
/* The card had the same 3px ribbon across its top edge and it is gone for the
   same reason: it read as a hard rule, not as the day. In its place the card's
   own colours wash down from above and settle — no edge, and it arrives with
   the card. */
.fest-card::before { content: ''; position: absolute; inset: 0 0 auto; height: 46%; background: radial-gradient(120% 100% at 50% 0%, var(--fest-c1) 0%, transparent 62%), radial-gradient(80% 70% at 12% 0%, var(--fest-c2) 0%, transparent 60%), radial-gradient(80% 70% at 88% 0%, var(--fest-c3) 0%, transparent 60%); opacity: 0.16; animation: festWashIn 1.1s ease-out both; }
html.light .fest-card::before { opacity: 0.22; }
@keyframes festWashIn { from { opacity: 0; transform: translateY(-14px); } }
/* The emblem arrives inside a ring of light that opens once and clears. The
   crest carries the halo and the burst so both stay centred on the emblem
   however its size changes. */
.fest-crest { position: relative; width: 112px; height: 112px; margin: 2px auto 14px; }
.fest-card .fest-emblem { width: 112px; height: 112px; animation: festEmblemIn 0.8s cubic-bezier(0.2, 0.9, 0.3, 1.2) both; }
.fest-halo { position: absolute; inset: -6px; border-radius: 50%; border: 2px solid var(--fest-c2); opacity: 0; pointer-events: none; animation: festHalo 1.3s 0.12s cubic-bezier(0.1, 0.8, 0.3, 1) both; }
@keyframes festHalo { 0% { opacity: 0; transform: scale(0.35); } 24% { opacity: 0.7; } 100% { opacity: 0; transform: scale(1.8); } }
/* One burst of the day's colours when the greeting opens — it plays once and
   the pieces are gone. Each piece carries its own angle, distance and spin. */
.fest-burst { position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; }
.fest-burst i { position: absolute; width: 7px; height: 11px; margin: -5px 0 0 -3px; border-radius: 2px; opacity: 0; background: var(--fest-c1); animation: festPop 1.5s 0.2s cubic-bezier(0.15, 0.7, 0.3, 1) both; }
.fest-burst i:nth-child(3n + 1) { background: var(--fest-c2); }
.fest-burst i:nth-child(3n + 2) { background: var(--fest-c3); border-radius: 50%; width: 6px; height: 6px; }
@keyframes festPop { 0% { opacity: 0; transform: rotate(var(--fest-a)) translateY(0) rotate(0deg); } 12% { opacity: 1; } 70% { opacity: 0.9; } 100% { opacity: 0; transform: rotate(var(--fest-a)) translateY(calc(var(--fest-d) * -1)) rotate(var(--fest-s)); } }
.fest-card h2 { font-family: var(--vx-font-display); font-size: clamp(1.55rem, 6vw, 2rem); font-weight: 700; line-height: 1.15; letter-spacing: -0.01em; color: rgb(var(--ink-100)); animation: festRiseIn 0.6s 0.18s ease-out both; }
.fest-card p { margin-top: 8px; font-size: 0.95rem; line-height: 1.45; color: rgb(var(--ink-300)); animation: festRiseIn 0.6s 0.26s ease-out both; }
.fest-actions { display: grid; gap: 6px; margin-top: 20px; animation: festRiseIn 0.6s 0.3s ease-out both; }
.fest-btn { min-height: 46px; padding: 0 18px; border-radius: 999px; font-weight: 700; font-size: 0.95rem; color: rgb(var(--ink-200)); }
.fest-btn:focus-visible, .fest-banner button:focus-visible { outline: 2px solid rgb(var(--ember-400)); outline-offset: 2px; }
.fest-btn-primary { background: rgb(var(--ember-500)); color: var(--vx-on-accent, #111); }
/* Home greeting strip */
.fest-banner { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding: 10px 10px 10px 12px; border-radius: 18px; border: 1px solid rgb(var(--ember-500) / 0.3); background: linear-gradient(100deg, rgb(var(--ember-500) / 0.16), rgb(var(--ink-850) / 0.7)); }
.fest-banner .fest-emblem { flex: none; width: 40px; height: 40px; }
.fest-banner-text { flex: 1; min-width: 0; }
.fest-banner-text strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vx-font-display); font-size: 1rem; color: rgb(var(--ink-100)); }
.fest-banner-text span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8rem; color: rgb(var(--ink-300)); }
.fest-banner-play { flex: none; min-height: 38px; padding: 0 14px; border-radius: 999px; font-size: 0.82rem; font-weight: 700; background: rgb(var(--ember-500)); color: var(--vx-on-accent, #111); }
/* Phone: two lines at most. Greeting on one line (ellipsis), the action under it. */
@media (max-width: 479px) { .fest-banner { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 10px; row-gap: 6px; align-items: center; padding: 10px 8px 10px 12px; } .fest-banner .fest-emblem { grid-row: 1 / span 2; width: 44px; height: 44px; } .fest-banner-text { grid-column: 2; grid-row: 1; } .fest-banner-text span { display: none; } /* …unless it carries the day marker of a festival that runs for several days, which is the one thing on that line worth a row. */ .fest-banner[data-day] .fest-banner-text span { display: block; } .fest-banner-text strong { font-size: 0.98rem; } .fest-banner-x { grid-column: 3; grid-row: 1; width: 32px; height: 32px; } .fest-banner-play { grid-column: 2 / span 2; grid-row: 2; justify-self: start; min-height: 34px; padding: 0 14px; } }
.fest-banner-x { flex: none; width: 36px; height: 36px; border-radius: 999px; font-size: 1.1rem; line-height: 1; color: rgb(var(--ink-300)); }
@keyframes festSkyIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes festFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes festCardIn { from { opacity: 0; transform: translateY(14px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes festEmblemIn { from { opacity: 0; transform: scale(0.6) rotate(-10deg); } to { opacity: 1; transform: none; } }
@keyframes festRiseIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
/* Rise and fall now wander on the way. The horizontal waypoints alternate
   around the start column by --fest-sway, and the turn carries on through the
   whole travel, so a petal tumbles and a spark weaves instead of sliding. */
@keyframes festRise { 0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 0; } 10% { opacity: 0.5; } 28% { transform: translate3d(var(--fest-sway), -30vh, 0) rotate(26deg); } 52% { transform: translate3d(calc(var(--fest-sway) * -0.8), -58vh, 0) rotate(-14deg); } 78% { transform: translate3d(calc(var(--fest-sway) * 0.9), -86vh, 0) rotate(30deg); } 85% { opacity: 0.35; } 100% { transform: translate3d(0, -112vh, 0) rotate(52deg); opacity: 0; } }
@keyframes festFall { 0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 0; } 10% { opacity: 0.5; } 28% { transform: translate3d(var(--fest-sway), 30vh, 0) rotate(72deg); } 52% { transform: translate3d(calc(var(--fest-sway) * -0.85), 58vh, 0) rotate(146deg); } 78% { transform: translate3d(calc(var(--fest-sway) * 0.95), 86vh, 0) rotate(224deg); } 85% { opacity: 0.35; } 100% { transform: translate3d(0, 112vh, 0) rotate(310deg); opacity: 0; } }
@keyframes festSway { 0%, 100% { transform: translate(-50%, -50%) rotate(-5deg); } 50% { transform: translate(-50%, calc(-50% - 14px)) rotate(-2.5deg); } }
@keyframes festWave { 0%, 100% { transform: translateY(0) scaleY(1); } 50% { transform: translateY(4.5%) scaleY(0.965); } }
@keyframes festSpin { to { transform: translate(-50%, -50%) rotate(360deg); } }
@keyframes festBall { 0% { transform: translate3d(0, 0, 0); opacity: 0; } 7% { opacity: 0.34; } 88% { opacity: 0.26; } 100% { transform: translate3d(5vw, -118vh, 0); opacity: 0; } }
@keyframes festDrift { 0% { transform: translate3d(0, 0, 0) rotate(-6deg); opacity: 0.18; } 50% { transform: translate3d(calc(var(--fest-sway) * 0.7), -26px, 0) rotate(6deg); opacity: 0.42; } 100% { transform: translate3d(calc(var(--fest-sway) * 1.6), -14px, 0) rotate(14deg); opacity: 0.45; } }
@keyframes festBreathe { 0%, 100% { opacity: calc(var(--fest-glow-o) * 0.78); } 50% { opacity: calc(var(--fest-glow-o) * 1.2); } }
@keyframes festMotifDrift { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(3.5%, 2.5%, 0); } }
@keyframes festWmFloat { 0%, 100% { transform: rotate(-8deg) translate3d(0, 0, 0); } 50% { transform: rotate(-5.5deg) translate3d(0, -2.4vmin, 0); } }
/* Reduced motion keeps the skin and loses the movement. FestBackdrop already
   declines to render any of this (either switch, or data saver), so these rules
   are the backstop for a skin painted before the preference is read — and they
   cover the sky's and each set piece's pseudo-elements, which a bare
   universal selector alone misses,
   so nothing is left breathing, drifting or flickering. */
html.reduce-motion .fest-particles, html.reduce-motion .fest-p, html.reduce-motion .fest-flag, html.reduce-motion .fest-ball, html.reduce-motion .fest-set { display: none; }
html.reduce-motion .fest-splash, html.reduce-motion .fest-splash *, html.reduce-motion .fest-splash *::before, html.reduce-motion .fest-splash *::after, html.reduce-motion .fest-sky, html.reduce-motion .fest-sky::before, html.reduce-motion .fest-sky::after, html.reduce-motion .fest-sky *, html.reduce-motion .fest-sky *::before, html.reduce-motion .fest-sky *::after { animation: none !important; }
@media (prefers-reduced-motion: reduce) { .fest-particles, .fest-p, .fest-flag, .fest-ball, .fest-set { display: none; } .fest-splash, .fest-splash *, .fest-splash *::before, .fest-splash *::after, .fest-sky, .fest-sky::before, .fest-sky::after, .fest-sky *, .fest-sky *::before, .fest-sky *::after { animation: none !important; } }
/* Black theme stays true black: only accent, ribbon and particles apply. */
html.amoled[class*='fest-'] { --ink-950: 0 0 0; --ink-900: 0 0 0; --ink-850: 8 8 11; --ink-800: 16 17 22; }
html.amoled[class*='fest-'] .fest-sky::before, html.amoled[class*='fest-'] .fest-sky::after, html.amoled[class*='fest-'] .fest-sky .fest-wm { display: none; }
`);
  for (const f of festivals) {
    const t = themes[f.id];
    if (!t) throw new Error(`festivalThemes.ts has no entry for "${f.id}"`);
    const cls = festClass(f.id);
    const r = ramps(t.accent);
    const cv = canvas(t.canvasHue ?? r.hue, t.canvasSat ?? 1);
    const m = motifCss(t.motif, t.ribbon);
    const ec = emblemColours(t);
    const vars = [
      `--ember-300: ${r.dark[300]}; --ember-400: ${r.dark[400]}; --ember-500: ${r.dark[500]}; --ember-600: ${r.dark[600]};`,
      `--ink-950: ${cv.dark[950]}; --ink-900: ${cv.dark[900]}; --ink-850: ${cv.dark[850]}; --ink-800: ${cv.dark[800]};`,
      `--fest-glow: ${glowCss(t.glowShape, t.glow)};`,
      `--fest-c1: rgb(var(--ember-400)); --fest-c2: rgb(${ec.dark[0]}); --fest-c3: rgb(${ec.dark[1]});`,
      m ? `--fest-motif: ${m.image}; --fest-motif-size: ${m.size};${m.pos ? ` --fest-motif-pos: ${m.pos};` : ''}${m.repeat ? ` --fest-motif-repeat: ${m.repeat};` : ''}` : '--fest-motif: none;',
    ];
    out.push(`/* ${f.name} — ${f.when} */`);
    out.push(`html.${cls} {\n  ${vars.join('\n  ')}\n}`);
    out.push(`html.${cls}.light {\n  --ember-300: ${r.light[300]}; --ember-400: ${r.light[400]}; --ember-500: ${r.light[500]}; --ember-600: ${r.light[600]};\n  --ink-950: ${cv.light[950]}; --ink-900: ${cv.light[900]}; --ink-850: ${cv.light[850]}; --ink-800: ${cv.light[800]};\n  --fest-c2: rgb(${ec.light[0]}); --fest-c3: rgb(${ec.light[1]});\n}`);
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
export function buildAdminJs(festivals, themes, visuals = {}, emblemSvg = null) {
  const rows = festivals.map((f) => {
    const t = themes[f.id];
    const v = visuals[f.id];
    const r = ramps(t.accent);
    const cv = canvas(t.canvasHue ?? r.hue, t.canvasSat ?? 1);
    return {
      id: f.id, name: f.name, when: f.when, fx: f.fx, greeting: f.greeting,
      win: f.windows.map(([mf, df, mt, dt]) => [enc(mf, df), enc(mt, dt)]),
      colors: f.colors, accent: `rgb(${r.dark[500]})`, canvas: `rgb(${cv.dark[900]})`, ribbon: ribbonCss(t.ribbon),
      motif: t.motif, forceOnly: f.windows.length === 0,
      // 'image' used to be a remote photo; it is now the drawn emblem as a data URI.
      image: v && emblemSvg ? 'data:image/svg+xml,' + encodeURIComponent(emblemSvg(v.emblem, emblemColours(t).hex)) : '', imagePosition: 'center',
      confetti: v?.particle ?? 'spark', emblem: v?.emblem ?? '', blurb: v?.blurb ?? '', query: v?.query ?? '',
    };
  });
  return `// GENERATED by scripts/gen-festivals.mjs — the app's festival calendar + skins. Do not edit.\nwindow.VX_FESTIVALS = ${JSON.stringify(rows)};\n`;
}
