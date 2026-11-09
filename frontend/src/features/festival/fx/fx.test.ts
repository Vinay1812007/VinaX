import { describe, expect, it } from 'vitest';
import { FESTIVALS } from '@/constants/festivals';
import { FX_KINDS, fxFor, fxLine, paletteOf } from './festivalFx';
import { budgetFor, burstInto, createSystem, step } from './particles';

describe('festival effects', () => {
  it('gives every festival at least one live effect, all of known kinds', () => {
    for (const f of FESTIVALS) {
      const kinds = fxFor(f.id);
      expect(kinds.length, f.id).toBeGreaterThan(0);
      for (const k of kinds) expect(FX_KINDS).toContain(k);
      expect(fxLine(f.id)).toMatch(/\w/);
      expect(paletteOf(f).length).toBeGreaterThan(0);
    }
    expect(fxFor('diwali')).toEqual(['diyas', 'fireworks', 'sparkle']);
    expect(fxFor('holi')[0]).toBe('powder');
    expect(fxFor('christmas')[0]).toBe('snow');
    expect(fxFor('sankranti')[0]).toBe('kites');
    expect(fxFor('eid')[0]).toBe('lanterns');
    expect(fxFor('not-a-festival')).toEqual(['sparkle']);
  });
  it('keeps the sky within its budget on every kind', () => {
    for (const k of FX_KINDS) {
      const s = createSystem([k], ['#f00', '#0f0', '#00f'], 1280, 720, { seed: 3 });
      let most = 0;
      for (let i = 0; i < 600; i++) { step(s, 1 / 60); most = Math.max(most, s.particles.length); expect(s.particles.length, k).toBeLessThanOrEqual(s.maxParticles); }
      expect(most, k).toBeGreaterThan(0);
      for (const p of s.particles) { expect(Number.isFinite(p.x), k).toBe(true); expect(Number.isFinite(p.y), k).toBe(true); }
    }
  });
  it('draws the same sky for the same seed', () => {
    const a = createSystem(['confetti', 'fireworks'], ['#fff', '#f0f'], 800, 600, { seed: 11 });
    const b = createSystem(['confetti', 'fireworks'], ['#fff', '#f0f'], 800, 600, { seed: 11 });
    for (let i = 0; i < 200; i++) { step(a, 1 / 60); step(b, 1 / 60); }
    expect(a.particles.map((p) => [p.x, p.y])).toEqual(b.particles.map((p) => [p.x, p.y]));
  });
  it('scales the budget with the screen, within bounds', () => {
    expect(budgetFor(360, 640)).toBeLessThan(budgetFor(1920, 1080));
    expect(budgetFor(100, 100)).toBeGreaterThanOrEqual(16);
    expect(budgetFor(4000, 3000)).toBeLessThanOrEqual(120);
  });
  it('a burst fires once and then falls quiet', () => {
    const s = createSystem(['confetti'], ['#f00'], 800, 600, { seed: 1, burst: true });
    burstInto(s, 'confetti');
    expect(s.particles.length).toBeGreaterThan(50);
    expect(s.maxParticles).toBeGreaterThan(budgetFor(800, 600));
    for (let i = 0; i < 60 * 8; i++) step(s, 1 / 60);
    expect(s.particles.length).toBe(0);
    burstInto(s, 'fireworks');
    expect(s.particles.filter((p) => p.rocket)).toHaveLength(4);
    for (let i = 0; i < 150; i++) step(s, 1 / 60);
    expect(s.particles.filter((p) => !p.rocket).length).toBeGreaterThan(20);
  });
});
