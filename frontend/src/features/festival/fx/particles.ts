import type { FxKind } from './festivalFx';

/**
 * 1.12 — the live festival effects, as one small particle system drawn on a
 * 2D canvas: confetti, fireworks, petals, balloons, diyas, snow, colour
 * powder, kites, lanterns, sparkle, leaves and hearts. Pure maths here (a
 * seeded random, a step, a draw); the React side (FestivalFxCanvas,
 * CelebrationLayer) owns the canvas, the clock and the settings.
 *
 * Budget: `maxParticles` caps everything alive at once (the canvas picks it
 * from the screen size), emitters never exceed it, and `step` is O(n). All
 * shapes are cheap fills — no shadows or blurs per particle; the glow of a
 * diya or a lantern is one radial gradient per piece.
 */

export interface Particle {
  kind: FxKind;
  x: number; y: number; vx: number; vy: number;
  /** Seconds lived and the life span (Infinity = until off screen). */
  age: number; life: number;
  size: number; rot: number; spin: number; color: string;
  /** Per-kind phase for sway and flicker. */
  phase: number;
  /** Fireworks: a rocket climbing (true) or a spark (false). */
  rocket?: boolean;
  /** Kites: tail points. */
  tail?: Array<[number, number]>;
}

export interface FxSystem {
  kinds: FxKind[];
  palette: string[];
  w: number; h: number;
  maxParticles: number;
  particles: Particle[];
  rnd: () => number;
  /** Seconds since the last fireworks launch, per system. */
  sinceLaunch: number;
  /** One-shot burst mode (celebrations): no steady emission. */
  burst: boolean;
  time: number;
}

/** mulberry32 — a tiny seeded random so tests see the same sky twice. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How many pieces a screen can carry (one rule for ambient and bursts). The
 * sky is decoration behind the app, so the budget is small: about 70 on a
 * laptop, 40 on a phone, 120 at most; the canvas lowers it further when
 * frames run long (useFxCanvas).
 */
export function budgetFor(w: number, h: number, intensity = 1): number {
  const area = (w * h) / (1280 * 720);
  return Math.max(16, Math.min(120, Math.round(70 * Math.min(1.5, Math.max(0.45, area)) * intensity)));
}

export function createSystem(kinds: FxKind[], palette: string[], w: number, h: number, o: { seed?: number; maxParticles?: number; burst?: boolean } = {}): FxSystem {
  // A celebration is short and on top of everything, so it may spend twice the ambient budget.
  const budget = o.maxParticles ?? (o.burst ? Math.min(200, budgetFor(w, h) * 2.5) : budgetFor(w, h));
  return { kinds: kinds.length ? kinds : ['sparkle'], palette: palette.length ? palette : ['#ffa42e'], w, h, maxParticles: Math.round(budget), particles: [], rnd: seeded(o.seed ?? 7), sinceLaunch: 99, burst: !!o.burst, time: 0 };
}

export function resize(s: FxSystem, w: number, h: number): void {
  s.w = w; s.h = h;
  s.maxParticles = Math.min(s.maxParticles, s.burst ? Math.round(Math.min(200, budgetFor(w, h) * 2.5)) : budgetFor(w, h));
}

const pick = <T,>(s: FxSystem, list: readonly T[]): T => list[Math.floor(s.rnd() * list.length)]!;
const between = (s: FxSystem, a: number, b: number): number => a + s.rnd() * (b - a);

function spawn(s: FxSystem, p: Partial<Particle> & { kind: FxKind }): Particle | null {
  if (s.particles.length >= s.maxParticles) return null;
  const n: Particle = { x: 0, y: 0, vx: 0, vy: 0, age: 0, life: Infinity, size: 6, rot: 0, spin: 0, color: pick(s, s.palette), phase: s.rnd() * Math.PI * 2, ...p };
  s.particles.push(n);
  return n;
}

/** Share of the budget each kind of ambient effect keeps alive. */
const SHARE: Record<FxKind, number> = {
  confetti: 0.55, fireworks: 0.6, petals: 0.45, balloons: 0.18, diyas: 0.25, snow: 0.7, powder: 0.5, kites: 0.08, lanterns: 0.16, sparkle: 0.5, leaves: 0.4, hearts: 0.3,
};

function emit(s: FxSystem, kind: FxKind, dt: number): void {
  const alive = s.particles.filter((p) => p.kind === kind).length;
  const target = Math.round((s.maxParticles * SHARE[kind]) / s.kinds.length);
  const room = target - alive;
  if (room <= 0 && kind !== 'fireworks') return;
  const w = s.w, h = s.h;
  switch (kind) {
    case 'confetti': {
      const n = Math.min(room, Math.ceil(dt * 30));
      for (let i = 0; i < n; i++) spawn(s, { kind, x: s.rnd() * w, y: -10, vx: between(s, -20, 20), vy: between(s, 60, 120), size: between(s, 5, 9), rot: s.rnd() * 6.3, spin: between(s, -5, 5) });
      return;
    }
    case 'snow': {
      const n = Math.min(room, Math.ceil(dt * 40));
      for (let i = 0; i < n; i++) spawn(s, { kind, x: s.rnd() * w, y: -6, vx: between(s, -8, 8), vy: between(s, 25, 60), size: between(s, 1.5, 4), color: '#ffffff' });
      return;
    }
    case 'petals': case 'leaves': case 'hearts': {
      const n = Math.min(room, Math.ceil(dt * 14));
      for (let i = 0; i < n; i++) spawn(s, { kind, x: s.rnd() * w, y: -12, vx: between(s, -15, 15), vy: between(s, 30, 70), size: between(s, 6, 12), rot: s.rnd() * 6.3, spin: between(s, -2, 2) });
      return;
    }
    case 'balloons': case 'lanterns': {
      const n = Math.min(room, Math.ceil(dt * 3));
      for (let i = 0; i < n; i++) spawn(s, { kind, x: s.rnd() * w, y: h + 30, vx: between(s, -6, 6), vy: between(s, -22, -45), size: kind === 'balloons' ? between(s, 12, 22) : between(s, 9, 15) });
      return;
    }
    case 'kites': {
      const n = Math.min(room, Math.ceil(dt * 1.5));
      for (let i = 0; i < n; i++) spawn(s, { kind, x: -40, y: between(s, h * 0.1, h * 0.6), vx: between(s, 35, 70), vy: between(s, -6, 6), size: between(s, 14, 24), tail: [] });
      return;
    }
    case 'sparkle': {
      const n = Math.min(room, Math.ceil(dt * 20));
      for (let i = 0; i < n; i++) spawn(s, { kind, x: s.rnd() * w, y: s.rnd() * h * 0.8, size: between(s, 1, 3), life: between(s, 1.2, 3) });
      return;
    }
    case 'diyas': {
      // A row of lamps along the bottom, lit once; embers rise from them.
      if (alive === 0) {
        const lamps = Math.max(4, Math.min(12, Math.round(w / 120)));
        for (let i = 0; i < lamps; i++) spawn(s, { kind, x: ((i + 0.5) * w) / lamps, y: h - 14, size: between(s, 9, 13), color: '#ffb347', rocket: true });
      }
      if (room > 0 && s.rnd() < dt * 6) {
        const lamp = pick(s, s.particles.filter((p) => p.kind === 'diyas' && p.rocket));
        if (lamp) spawn(s, { kind, x: lamp.x + between(s, -4, 4), y: lamp.y - 10, vx: between(s, -6, 6), vy: between(s, -25, -50), size: between(s, 1.2, 2.4), life: between(s, 1.2, 2.4), color: '#ffd27a' });
      }
      return;
    }
    case 'powder': {
      if (s.rnd() < dt * 0.6 && room > 20) {
        const cx = s.rnd() * w, cy = between(s, h * 0.15, h * 0.8), color = pick(s, s.palette);
        spawn(s, { kind, x: cx, y: cy, size: between(s, 40, 90), life: 2.6, color, rocket: true });
        for (let i = 0; i < 18; i++) { const a = s.rnd() * 6.3, v = between(s, 40, 160); spawn(s, { kind, x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, size: between(s, 2, 5), life: between(s, 1, 2), color }); }
      }
      return;
    }
    case 'fireworks': {
      s.sinceLaunch += dt;
      const gap = s.burst ? 0.35 : between(s, 1.6, 3.2);
      if (s.sinceLaunch > gap && room > 30) {
        s.sinceLaunch = 0;
        spawn(s, { kind, x: between(s, w * 0.15, w * 0.85), y: h + 6, vx: between(s, -12, 12), vy: -between(s, h * 0.55, h * 0.85), size: 2.4, life: between(s, 0.9, 1.25), rocket: true });
      }
      return;
    }
  }
}

function explode(s: FxSystem, p: Particle): void {
  const color = pick(s, s.palette), second = pick(s, s.palette);
  const sparks = Math.min(70, Math.max(24, s.maxParticles - s.particles.length));
  for (let i = 0; i < sparks; i++) {
    const a = (i / sparks) * Math.PI * 2 + s.rnd() * 0.2, v = between(s, 60, 190);
    spawn(s, { kind: 'fireworks', x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: between(s, 1.6, 3), life: between(s, 1.1, 1.9), color: i % 2 ? color : second });
  }
}

/** Advance the sky by `dt` seconds (clamped: a hidden tab does not fling pieces away). */
export function step(s: FxSystem, dt: number): void {
  dt = Math.min(0.05, Math.max(0, dt));
  s.time += dt;
  if (!s.burst) for (const k of s.kinds) emit(s, k, dt);
  const keep: Particle[] = [];
  const w = s.w, h = s.h, t = s.time;
  for (const p of s.particles) {
    p.age += dt;
    const sway = Math.sin(t * 1.3 + p.phase);
    switch (p.kind) {
      case 'confetti':
        p.vy = Math.min(p.vy + 40 * dt, 160); p.x += (p.vx + sway * 40) * dt; p.y += p.vy * dt; p.rot += p.spin * dt; break;
      case 'snow':
        p.x += (p.vx + sway * 14) * dt; p.y += p.vy * dt; break;
      case 'petals': case 'leaves': case 'hearts':
        p.x += (p.vx + sway * 28) * dt; p.y += p.vy * dt; p.rot += (p.spin + sway * 0.8) * dt; break;
      case 'balloons': case 'lanterns':
        p.x += (p.vx + sway * 10) * dt; p.y += p.vy * dt; break;
      case 'kites':
        p.x += p.vx * dt; p.y += (p.vy + Math.sin(t * 0.9 + p.phase) * 22) * dt;
        if (p.tail) { p.tail.unshift([p.x, p.y + p.size]); if (p.tail.length > 12) p.tail.pop(); }
        break;
      case 'sparkle': case 'diyas': case 'powder':
        if (p.kind === 'powder' && !p.rocket) { p.vx *= 1 - 1.8 * dt; p.vy = p.vy * (1 - 1.8 * dt) + 30 * dt; }
        if (!p.rocket || p.kind !== 'diyas') { p.x += p.vx * dt; p.y += p.vy * dt; }
        break;
      case 'fireworks':
        if (p.rocket) { p.vy += 120 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.age >= p.life || p.vy > -40) { explode(s, p); continue; } }
        else { p.vy += 70 * dt; p.vx *= 1 - 0.9 * dt; p.vy *= 1 - 0.4 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
        break;
    }
    const dead = p.age >= p.life || p.y > h + 40 || p.y < -80 || p.x > w + 80 || p.x < -80;
    if (!dead) keep.push(p);
  }
  s.particles = keep;
}

/** Pre-rendered soft glows (a radial gradient is costly per particle per frame; a sprite is one drawImage). */
const glowCache = new Map<string, CanvasImageSource>();
function glowSprite(color: string, radius: number): CanvasImageSource | null {
  const r = Math.max(4, Math.round(radius));
  const key = `${color}|${r}`;
  const hit = glowCache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = r * 2;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(r, r, 1, r, r, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, r * 2, r * 2);
  if (glowCache.size > 40) glowCache.clear();
  glowCache.set(key, c);
  return c;
}
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number): void {
  const sp = glowSprite(color, radius);
  if (!sp) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  ctx.drawImage(sp, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prev;
}

/** Alpha for a piece that fades in and out over its life. */
const fadeOf = (p: Particle): number => {
  if (!Number.isFinite(p.life)) return 1;
  const r = p.age / p.life;
  return r < 0.15 ? r / 0.15 : r > 0.7 ? Math.max(0, (1 - r) / 0.3) : 1;
};

function heart(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, r * 0.35);
  ctx.bezierCurveTo(r * 1.1, -r * 0.6, r * 0.5, -r * 1.2, 0, -r * 0.45);
  ctx.bezierCurveTo(-r * 0.5, -r * 1.2, -r * 1.1, -r * 0.6, 0, r * 0.35);
  ctx.fill();
}

/** Draw the sky. The caller clears the canvas and scales for the pixel ratio. */
export function draw(s: FxSystem, ctx: CanvasRenderingContext2D): void {
  const t = s.time;
  for (const p of s.particles) {
    const a = fadeOf(p);
    if (a <= 0) continue;
    // Plain dots (snow, sparks, embers, powder grains) skip save/restore and paths: one arc each.
    if (p.kind === 'snow' || (p.kind === 'fireworks' && !p.rocket) || (p.kind === 'diyas' && !p.rocket) || (p.kind === 'powder' && !p.rocket)) {
      ctx.globalAlpha = p.kind === 'snow' ? a * 0.85 : a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.kind === 'fireworks' ? p.size * (1 - 0.4 * (p.age / p.life)) : p.size, 0, 6.3);
      ctx.fill();
      continue;
    }
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    switch (p.kind) {
      case 'confetti':
        ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, 0.55 + 0.45 * Math.sin(t * 6 + p.phase)); ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66); break;
      case 'petals': case 'leaves':
        ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * (p.kind === 'leaves' ? 0.4 : 0.6), 0, 0, 6.3); ctx.fill(); break;
      case 'hearts':
        ctx.translate(p.x, p.y); ctx.rotate(p.rot * 0.2); heart(ctx, p.size); break;
      case 'balloons': {
        ctx.translate(p.x, p.y); ctx.beginPath(); ctx.ellipse(0, 0, p.size * 0.78, p.size, 0, 0, 6.3); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, p.size); ctx.quadraticCurveTo(4, p.size + 14, -2, p.size + 28); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(-p.size * 0.3, -p.size * 0.4, p.size * 0.18, p.size * 0.32, -0.5, 0, 6.3); ctx.fill(); break;
      }
      case 'lanterns': {
        const flick = 0.75 + 0.25 * Math.sin(t * 9 + p.phase);
        glow(ctx, p.x, p.y, p.size * 3.2, 'rgba(255,200,110,0.42)', a * flick);
        ctx.fillStyle = p.color; ctx.globalAlpha = a * 0.95; ctx.beginPath(); ctx.roundRect(p.x - p.size * 0.6, p.y - p.size, p.size * 1.2, p.size * 2, p.size * 0.3); ctx.fill();
        ctx.fillStyle = `rgba(255,230,160,${flick})`; ctx.fillRect(p.x - p.size * 0.35, p.y - p.size * 0.6, p.size * 0.7, p.size * 1.1); break;
      }
      case 'kites': {
        if (p.tail && p.tail.length > 1) { ctx.strokeStyle = p.color; ctx.globalAlpha = a * 0.6; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.tail[0]![0], p.tail[0]![1]); for (const [x, y] of p.tail) ctx.lineTo(x, y + Math.sin(t * 7 + x * 0.05) * 3); ctx.stroke(); }
        ctx.globalAlpha = a; ctx.translate(p.x, p.y); ctx.rotate(0.25);
        ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(p.size * 0.7, 0); ctx.lineTo(0, p.size * 1.1); ctx.lineTo(-p.size * 0.7, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(0, p.size * 1.1); ctx.moveTo(-p.size * 0.7, 0); ctx.lineTo(p.size * 0.7, 0); ctx.stroke(); break;
      }
      case 'sparkle': {
        const tw = 0.5 + 0.5 * Math.sin(t * 5 + p.phase);
        ctx.globalAlpha = a * tw; ctx.fillStyle = '#fff6d6'; ctx.translate(p.x, p.y);
        ctx.beginPath(); const r = p.size * (1 + tw); ctx.moveTo(0, -r * 2); ctx.lineTo(r * 0.5, -r * 0.5); ctx.lineTo(r * 2, 0); ctx.lineTo(r * 0.5, r * 0.5); ctx.lineTo(0, r * 2); ctx.lineTo(-r * 0.5, r * 0.5); ctx.lineTo(-r * 2, 0); ctx.lineTo(-r * 0.5, -r * 0.5); ctx.closePath(); ctx.fill(); break;
      }
      case 'diyas': {
        if (p.rocket) {
          const flick = 0.8 + 0.2 * Math.sin(t * 11 + p.phase) + 0.08 * Math.sin(t * 23 + p.phase * 2);
          glow(ctx, p.x, p.y - p.size, p.size * 4.5, 'rgba(255,190,90,0.5)', a * flick);
          ctx.fillStyle = '#b4532a'; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.size, p.size * 0.45, 0, 0, 6.3); ctx.fill();
          ctx.fillStyle = `rgba(255,214,120,${flick})`; ctx.beginPath(); ctx.ellipse(p.x, p.y - p.size * 0.9, p.size * 0.32, p.size * 0.9 * flick, 0, 0, 6.3); ctx.fill();
        } else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.3); ctx.fill(); }
        break;
      }
      case 'powder': {
        if (p.rocket) { const r = p.age / p.life; glow(ctx, p.x, p.y, p.size * (0.4 + r), p.color, 0.45 * (1 - r)); }
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.3); ctx.fill(); }
        break;
      }
      case 'fireworks':
        if (p.rocket) { ctx.fillStyle = '#ffe9b0'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.3); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - 0.4 * (p.age / p.life)), 0, 6.3); ctx.fill(); }
        break;
    }
    ctx.restore();
  }
}

/** A one-shot celebration: a wide confetti pour or a volley of fireworks, fired at once. */
export function burstInto(s: FxSystem, kind: 'confetti' | 'fireworks', at?: { x: number; y: number }): void {
  if (kind === 'confetti') {
    const n = Math.min(s.maxParticles, 160);
    const ox = at?.x ?? s.w / 2, oy = at?.y ?? s.h * 0.35;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + between(s, -1.1, 1.1), v = between(s, 220, 520);
      spawn(s, { kind: 'confetti', x: ox + between(s, -30, 30), y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: between(s, 5, 10), rot: s.rnd() * 6.3, spin: between(s, -8, 8), life: between(s, 2.4, 3.6) });
    }
    return;
  }
  const volleys = 4;
  for (let i = 0; i < volleys; i++) {
    spawn(s, { kind: 'fireworks', x: at?.x ?? between(s, s.w * 0.2, s.w * 0.8), y: s.h + 6, vx: between(s, -15, 15), vy: -between(s, s.h * 0.6, s.h * 0.9), size: 2.4, life: between(s, 0.6, 1.1) + i * 0.25, rocket: true });
  }
}
