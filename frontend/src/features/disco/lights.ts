/**
 * Disco lights — the renderer. Draws one frame of the light show on a 2D
 * canvas from the beat reader's output; holds only its own animation state
 * (time, the beat pulse, colour step, the mirror-ball dots), so the page
 * owns the canvas, the clock and the settings.
 *
 * Lights add up (`lighter` compositing) over a near-black room, with a short
 * trail so beams leave a little light behind them as they sweep.
 *
 * Photosensitivity: the white flash is off unless the listener turns it on,
 * never fires closer than FLASH_GAP_MS (under three a second), and never
 * fires under reduced motion. The full-screen wash changes colour at most
 * every WASH_STEP_MS and fades between colours rather than cutting.
 */
import type { DiscoPalette, DiscoStyle } from './discoStore';

/** Never more than three flashes a second. */
export const FLASH_GAP_MS = 340;
/** The wash changes colour at most twice a second. */
export const WASH_STEP_MS = 500;
/** The Brightness slider's top (150%). */
export const MAX_BRIGHTNESS = 1.5;
/** How quickly the beat pulse fades (ms time constant). */
const PULSE_TAU = 220;
const FLASH_TAU = 70;

export interface LightInput {
  beat: boolean;
  /** 1 = right at the threshold; more is a harder hit. */
  strength: number;
  /** Bass level 0-1. */
  level: number;
  /** High-end level 0-1. */
  sparkle: number;
}

export interface LightOptions {
  style: DiscoStyle;
  /** Hues (degrees) the lights cycle through. */
  hues: readonly number[];
  brightness: number;
  speed: number;
  flash: boolean;
  /** Reduced motion: slower, softer, never a flash. */
  calm: boolean;
}

const PALETTE_HUES: Record<Exclude<DiscoPalette, 'artwork'>, number[]> = {
  /** Pure red, green and blue, like an RGB light strip. */
  rgb: [0, 120, 240],
  rainbow: [0, 40, 120, 190, 250, 300],
  /** Electric magenta, cyan, green and blue. */
  neon: [300, 180, 120, 240],
  warm: [8, 35, 330, 48],
  cool: [200, 172, 250, 222],
};
/** The app icon's own colours (plum, amber, pink, violet) when a cover gives none. */
const FALLBACK_HUES = [300, 38, 335, 270];

/** Hue (degrees) of an "R G B" triplet, or null when it is grey or malformed. */
export function hueOfTriplet(triplet: string | null | undefined): number | null {
  if (!triplet) return null;
  const parts = triplet.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [r, g, b] = parts.map((n) => Math.max(0, Math.min(255, n)) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.06) return null;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

/** The hues for a palette. "Song colours" builds a set around the cover's main colour. */
export function paletteHues(palette: DiscoPalette, artTriplet?: string | null): number[] {
  if (palette !== 'artwork') return PALETTE_HUES[palette];
  const h = hueOfTriplet(artTriplet);
  if (h == null) return FALLBACK_HUES;
  // The cover's colour, its neighbours, and its opposite for contrast.
  return [h, (h + 35) % 360, (h + 180) % 360, (h + 325) % 360];
}

/** Shortest way round the colour wheel from `a` toward `b`, by `k` (0-1). */
export function mixHue(a: number, b: number, k: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * Math.max(0, Math.min(1, k)) + 360) % 360;
}

interface Dot { x: number; y: number; r: number; v: number; seed: number }

export class DiscoRenderer {
  private t = 0;
  private now = 0;
  private pulse = 0;
  private glow = 0;
  private flashA = 0;
  private lastFlash = -Infinity;
  private step = 0;
  private lastStep = -Infinity;
  /** The wash's three colours as they fade toward the palette's. */
  private washHues: number[] | null = null;
  private dots: Dot[];
  private spots = Array.from({ length: 4 }, (_, i) => ({ x: 0.3 + 0.13 * i, y: 0.5, tx: 0.5, ty: 0.5 }));
  private readonly rand: () => number;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
    this.dots = Array.from({ length: 70 }, () => ({ x: rand(), y: rand() * 0.85, r: 1.2 + rand() * 2.4, v: 0.4 + rand() * 0.8, seed: rand() * 100 }));
    this.spots.forEach((s) => {
      s.tx = 0.15 + rand() * 0.7;
      s.ty = 0.15 + rand() * 0.7;
    });
  }

  /** Flashes so far (for tests and the photosensitivity cap). */
  get flashCount(): number {
    return this.flashes;
  }
  private flashes = 0;

  /** Advance by `dt` ms and draw one frame on a `w` x `h` (CSS pixel) context. */
  frame(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, input: LightInput, o: LightOptions): void {
    const d = Math.max(0, Math.min(100, dt)); // a stalled tab must not jump the show
    this.now += d;
    const motion = o.speed * (o.calm ? 0.35 : 1);
    this.glow += (input.level - this.glow) * Math.min(1, d / 90);
    this.t += d * motion * (0.75 + 0.6 * this.glow);
    this.pulse *= Math.exp(-d / PULSE_TAU);
    this.flashA *= Math.exp(-d / FLASH_TAU);

    if (input.beat) {
      this.pulse = o.calm ? 0.55 : 1;
      const washGate = o.style !== 'wash' || this.now - this.lastStep >= WASH_STEP_MS;
      if (washGate) {
        this.step += 1;
        this.lastStep = this.now;
      }
      if (o.style === 'spotlights') {
        for (const s of this.spots) {
          s.tx = 0.12 + this.rand() * 0.76;
          s.ty = 0.12 + this.rand() * 0.76;
        }
      }
      if (o.flash && !o.calm && input.strength >= 1.25 && this.now - this.lastFlash >= FLASH_GAP_MS) {
        this.flashA = 1;
        this.lastFlash = this.now;
        this.flashes += 1;
      }
    }

    const hues = o.hues.length ? o.hues : FALLBACK_HUES;
    const hue = (i: number) => hues[(((i + this.step) % hues.length) + hues.length) % hues.length];
    // Up to 1.5: past 1 the lights get bolder and fill more of the screen (alphas cap at 1).
    const b = Math.max(0.2, Math.min(MAX_BRIGHTNESS, o.brightness));

    // The room: near-black, with a trail so moving light lingers a moment.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(4, 2, 10, ${o.style === 'wash' || o.calm ? 1 : 0.3})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    if (o.style === 'party') this.party(ctx, w, h, b, hue, input.sparkle);
    else if (o.style === 'spotlights') this.spotlights(ctx, w, h, b, hue, d);
    else if (o.style === 'lasers') this.lasers(ctx, w, h, b, hue, input.sparkle);
    else this.wash(ctx, w, h, b, [hue(0), hue(1), hue(2)], d);

    if (this.flashA > 0.02) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.85, this.flashA * 0.7 * b)})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private party(ctx: CanvasRenderingContext2D, w: number, h: number, b: number, hue: (i: number) => number, sparkle: number): void {
    const n = 5;
    const len = Math.hypot(w, h) * 1.1;
    const spread = 0.08 + 0.05 * this.glow;
    const a = b * (0.12 + 0.38 * this.pulse + 0.15 * this.glow);
    for (let i = 0; i < n; i += 1) {
      const sx = (w * (i + 0.5)) / n;
      const sy = -h * 0.04;
      const ang = Math.PI / 2 + Math.sin(this.t * 0.0006 * (1 + i * 0.17) + i * 1.3) * 0.6;
      const g = ctx.createLinearGradient(sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
      g.addColorStop(0, `hsla(${hue(i)}, 100%, 62%, ${a})`);
      g.addColorStop(1, `hsla(${hue(i)}, 100%, 55%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(ang - spread) * len, sy + Math.sin(ang - spread) * len);
      ctx.lineTo(sx + Math.cos(ang + spread) * len, sy + Math.sin(ang + spread) * len);
      ctx.closePath();
      ctx.fill();
    }
    // The floor lights up on the beat.
    const floor = ctx.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, Math.max(w, h) * 0.7);
    floor.addColorStop(0, `hsla(${hue(2)}, 100%, 55%, ${b * (0.14 + 0.36 * this.pulse)})`);
    floor.addColorStop(1, `hsla(${hue(2)}, 100%, 50%, 0)`);
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, w, h);
    // Mirror-ball dots drift across the room and twinkle with the hi-hats.
    for (const dot of this.dots) {
      const x = (((dot.x + this.t * 0.00004 * dot.v) % 1) + 1) % 1;
      const tw = 0.5 + 0.5 * Math.sin(this.t * 0.004 + dot.seed);
      const da = b * Math.min(1, 0.18 + 0.55 * sparkle * tw + 0.35 * this.pulse);
      ctx.fillStyle = `hsla(${hue(Math.floor(dot.seed))}, 70%, 86%, ${da})`;
      ctx.beginPath();
      ctx.arc(x * w, dot.y * h, dot.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private spotlights(ctx: CanvasRenderingContext2D, w: number, h: number, b: number, hue: (i: number) => number, d: number): void {
    const k = Math.min(1, d / 160);
    const r = Math.min(w, h) * (0.17 + 0.1 * this.pulse + 0.05 * this.glow);
    const a = b * (0.3 + 0.5 * this.pulse + 0.1 * this.glow);
    this.spots.forEach((s, i) => {
      // Glide toward the spot picked on the last beat, with a slow wander on top.
      s.x += (s.tx - s.x) * k;
      s.y += (s.ty - s.y) * k;
      const x = (s.x + Math.sin(this.t * 0.0005 + i * 2) * 0.05) * w;
      const y = (s.y + Math.cos(this.t * 0.0006 + i) * 0.05) * h;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `hsla(${hue(i)}, 100%, 68%, ${a})`);
      g.addColorStop(0.6, `hsla(${hue(i)}, 100%, 55%, ${a * 0.45})`);
      g.addColorStop(1, `hsla(${hue(i)}, 100%, 50%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private lasers(ctx: CanvasRenderingContext2D, w: number, h: number, b: number, hue: (i: number) => number, sparkle: number): void {
    const n = 14;
    const len = Math.hypot(w, h) * 1.2;
    const fan = 1.5 + 0.5 * Math.sin(this.t * 0.0007);
    const sway = Math.sin(this.t * 0.001) * 0.3;
    const a = b * Math.min(1, 0.22 + 0.6 * this.pulse + 0.18 * sparkle);
    const sx = w / 2;
    const sy = h * 1.02;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i += 1) {
      const ang = -Math.PI / 2 + (i / (n - 1) - 0.5) * fan + sway;
      const ex = sx + Math.cos(ang) * len;
      const ey = sy + Math.sin(ang) * len;
      const c = hue(i % 2);
      // A soft halo, then the bright core.
      ctx.strokeStyle = `hsla(${c}, 100%, 60%, ${a * 0.22})`;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${c}, 100%, 72%, ${a})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    const base = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.min(w, h) * 0.35);
    base.addColorStop(0, `hsla(${hue(0)}, 100%, 70%, ${b * (0.25 + 0.4 * this.pulse)})`);
    base.addColorStop(1, `hsla(${hue(0)}, 100%, 60%, 0)`);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * The whole screen in full-strength colour: the palette's colour as the
   * base, two more as big glowing clouds drifting across it, so red, green
   * and blue (or the chosen set) all fill the screen at once. Colours fade
   * into each other (never cut) and change at most every WASH_STEP_MS; the
   * beat lifts the brightness of the colour already showing.
   */
  private wash(ctx: CanvasRenderingContext2D, w: number, h: number, b: number, targets: number[], d: number): void {
    const k = Math.min(1, d / 260);
    this.washHues = this.washHues ? this.washHues.map((cur, i) => mixHue(cur, targets[i], k)) : [...targets];
    const [base, c1, c2] = this.washHues;
    const a = (x: number) => Math.min(1, x);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `hsla(${base}, 100%, 50%, ${a(b * (0.88 + 0.15 * this.glow))})`;
    ctx.fillRect(0, 0, w, h);
    const big = Math.max(w, h) * (0.55 + 0.1 * this.glow);
    const clouds: Array<[number, number, number]> = [
      [c1, 0.5 + 0.42 * Math.sin(this.t * 0.0004), 0.3 + 0.25 * Math.cos(this.t * 0.0005)],
      [c2, 0.5 + 0.42 * Math.cos(this.t * 0.00035 + 2), 0.72 + 0.22 * Math.sin(this.t * 0.00045 + 1)],
    ];
    for (const [c, cx, cy] of clouds) {
      const x = cx * w;
      const y = cy * h;
      const g = ctx.createRadialGradient(x, y, 0, x, y, big);
      g.addColorStop(0, `hsla(${c}, 100%, 52%, ${a(b * 0.95)})`);
      g.addColorStop(0.55, `hsla(${c}, 100%, 50%, ${a(b * 0.45)})`);
      g.addColorStop(1, `hsla(${c}, 100%, 50%, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // The beat: the same colours glow brighter for a moment (no white, no cut).
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `hsla(${base}, 100%, 55%, ${a(b * (0.08 + 0.2 * this.pulse))})`;
    ctx.fillRect(0, 0, w, h);
  }
}
