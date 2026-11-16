import { describe, it, expect } from 'vitest';
import { BeatDetector, bandLevel, bpmFromBeats, foldBpm, median, tapTempo, thresholdFor, MIN_GAP_MS } from './beat';

/** A 512-bin spectrum (47 Hz a bin) with the bass bins at `bass` and the top at `top`. */
function spectrum(bass: number, top = 0): Uint8Array {
  const s = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) {
    const hz = i * 47;
    if (hz >= 40 && hz <= 160) s[i] = bass;
    else if (hz >= 4000) s[i] = top;
    else s[i] = 30;
  }
  return s;
}

/** Feed a steady kick: `bpm` beats a minute for `ms`, 60 frames a second. Returns beat times. */
function drive(d: BeatDetector, bpm: number, ms: number, start = 0): number[] {
  const period = 60_000 / bpm;
  const beats: number[] = [];
  for (let t = start; t < start + ms; t += 1000 / 60) {
    const phase = ((t - start) % period) / period;
    // A sharp hit that decays over a fifth of the beat, on a quiet bed.
    const bass = phase < 0.2 ? 220 - phase * 600 : 60;
    if (d.push(spectrum(bass), 47, t).beat) beats.push(t);
  }
  return beats;
}

describe('bandLevel', () => {
  it('averages the bins in the band as 0-1', () => {
    expect(bandLevel(spectrum(255), 47, 40, 160)).toBeCloseTo(1, 5);
    expect(bandLevel(spectrum(0), 47, 40, 160)).toBe(0);
  });
  it('is 0 without a spectrum or a bin width', () => {
    expect(bandLevel([], 47, 40, 160)).toBe(0);
    expect(bandLevel(spectrum(200), 0, 40, 160)).toBe(0);
  });
});

describe('tempo helpers', () => {
  it('median', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it('folds half-time and double-time into a dance tempo', () => {
    expect(foldBpm(60)).toBe(120);
    expect(foldBpm(240)).toBe(120);
    expect(foldBpm(128)).toBe(128);
    expect(foldBpm(0)).toBe(0);
  });
  it('reads the tempo from beat times once there are four gaps', () => {
    expect(bpmFromBeats([0, 500, 1000, 1500])).toBeNull();
    expect(bpmFromBeats([0, 500, 1000, 1500, 2000])).toBe(120);
    // One missed beat (a 1 s gap) does not move the median.
    expect(bpmFromBeats([0, 500, 1000, 2000, 2500, 3000])).toBe(120);
  });
  it('a higher sensitivity lowers the threshold', () => {
    expect(thresholdFor(1)).toBeLessThan(thresholdFor(0));
    expect(thresholdFor(Number.NaN)).toBe(thresholdFor(0.5));
  });
});

describe('BeatDetector', () => {
  it('finds a steady kick and its tempo', () => {
    const d = new BeatDetector();
    const beats = drive(d, 120, 8000);
    // 16 kicks in 8 s; the first second only warms the average up.
    expect(beats.length).toBeGreaterThanOrEqual(13);
    expect(beats.length).toBeLessThanOrEqual(16);
    expect(d.bpm).toBe(120);
  });

  it('never fires two beats closer than the minimum gap', () => {
    const d = new BeatDetector();
    d.sensitivity = 1;
    const beats = drive(d, 300, 5000); // faster than anyone dances
    for (let i = 1; i < beats.length; i += 1) expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(MIN_GAP_MS);
  });

  it('a flat, loud bed is not a beat', () => {
    const d = new BeatDetector();
    let any = false;
    for (let t = 0; t < 4000; t += 16) any = d.push(spectrum(200), 47, t).beat || any;
    expect(any).toBe(false);
  });

  it('a quiet passage is not a beat, however it bumps', () => {
    const d = new BeatDetector();
    d.sensitivity = 1;
    let any = false;
    for (let t = 0; t < 4000; t += 16) any = d.push(spectrum(t % 500 < 60 ? 25 : 5), 47, t).beat || any;
    expect(any).toBe(false);
  });

  it('low sensitivity hears fewer beats than high on the same song', () => {
    const song = (s: number) => {
      const d = new BeatDetector();
      d.sensitivity = s;
      let n = 0;
      // Strong kicks every 600 ms, softer ones halfway between.
      for (let t = 0; t < 8000; t += 1000 / 60) {
        const p = t % 600;
        const bass = p < 50 ? 230 : p >= 300 && p < 350 ? 140 : 70;
        if (d.push(spectrum(bass), 47, t).beat) n += 1;
      }
      return n;
    };
    expect(song(0)).toBeLessThan(song(1));
  });

  it('starts its average over after a pause', () => {
    const d = new BeatDetector();
    drive(d, 120, 3000);
    // Paused for 10 s, then a loud steady bed: no stale average makes it a beat.
    let any = false;
    for (let t = 13_000; t < 14_000; t += 16) any = d.push(spectrum(210), 47, t).beat || any;
    expect(any).toBe(false);
  });

  it('reset forgets the tempo', () => {
    const d = new BeatDetector();
    drive(d, 120, 6000);
    expect(d.bpm).not.toBeNull();
    d.reset();
    expect(d.bpm).toBeNull();
  });

  it('reports bass level and sparkle within 0-1', () => {
    const d = new BeatDetector();
    const f = d.push(spectrum(255, 255), 47, 0);
    expect(f.level).toBeGreaterThan(0);
    expect(f.level).toBeLessThanOrEqual(1);
    expect(f.sparkle).toBeLessThanOrEqual(1);
  });
});

describe('tapTempo', () => {
  it('needs three taps', () => {
    expect(tapTempo([0, 500])).toBeNull();
    expect(tapTempo([0, 500, 1000])).toBe(120);
  });
  it('starts over after a two-second gap', () => {
    expect(tapTempo([0, 1000, 2000, 6000, 6400, 6800])).toBe(150);
  });
  it('ignores impossibly fast taps', () => {
    expect(tapTempo([0, 100, 200, 300])).toBeNull();
  });
});
