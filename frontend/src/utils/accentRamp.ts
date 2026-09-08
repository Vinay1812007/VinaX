/**
 * v5.17.0 — custom accent colour. From one hex the app derives the same
 * 300/400/500/600 ramps the built-in accents use (dark UI + an AA-safe light
 * UI), and applies them as inline variables on <html>. Mirrors the festival
 * generator's colour math (scripts/festivals-gen-core.mjs).
 */
function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}
function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
function contrastOnWhite(rgb: [number, number, number]): number {
  const lum = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 1.05 / (0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2] + 0.05);
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const trip = (h: number, s: number, l: number) => hslToRgb([h, clamp(s, 0, 100), clamp(l, 0, 100)]).join(' ');

export interface AccentRamps { dark: Record<300 | 400 | 500 | 600, string>; light: Record<300 | 400 | 500 | 600, string> }

export function accentRamps(hex: string): AccentRamps | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [h, s0, l0] = rgbToHsl(rgb);
  const mono = s0 < 12;
  const s = mono ? s0 : Math.max(s0, 60);
  const l500 = clamp(l0, 52, 64);
  const dark = { 300: trip(h, s, Math.min(88, l500 + 22)), 400: trip(h, s, l500 + 10), 500: trip(h, s, l500), 600: trip(h, s, l500 - 12) };
  const sl = mono ? s0 : Math.min(100, s + 8);
  let l300 = 40;
  while (l300 > 10 && contrastOnWhite(hslToRgb([h, sl, l300])) < 4.5) l300 -= 1;
  const light = { 300: trip(h, sl, l300), 400: trip(h, sl, l300 - 5), 500: trip(h, sl, l300 - 10), 600: trip(h, sl, l300 - 16) };
  return { dark, light };
}

/** Apply (or clear) a custom accent on <html>. Light mode picks the AA ramp. */
export function applyCustomAccent(hex: string | null | undefined, light: boolean): void {
  const st = document.documentElement.style;
  const ramps = hex ? accentRamps(hex) : null;
  for (const step of [300, 400, 500, 600] as const) {
    if (ramps) st.setProperty(`--ember-${step}`, (light ? ramps.light : ramps.dark)[step]);
    else st.removeProperty(`--ember-${step}`);
  }
}
