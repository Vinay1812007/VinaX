// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fitText, graphemes } from './fitText';

describe('fitText — cut between whole characters', () => {
  // A fake canvas where every grapheme is 10 px wide.
  const ctx = { measureText: (t: string) => ({ width: graphemes(t).length * 10 }) } as unknown as CanvasRenderingContext2D;

  it('keeps text that fits and cuts long text with an ellipsis', () => {
    expect(fitText(ctx, 'Srivalli', 100)).toBe('Srivalli');
    expect(fitText(ctx, 'Chuttamalle Chuttamalle', 100)).toBe('Chuttamal…');
  });

  it('never splits a Telugu conjunct or a vowel sign from its base', () => {
    const title = 'కన్నె కన్నె కన్నె కన్నె';
    const cut = fitText(ctx, title, 60);
    expect(cut.endsWith('…')).toBe(true);
    const body = cut.slice(0, -1);
    // Every cluster kept is a whole cluster of the original.
    const clusters = graphemes(title);
    expect(graphemes(body).every((g) => clusters.includes(g))).toBe(true);
    expect(clusters.includes(graphemes(body)[graphemes(body).length - 1] ?? '')).toBe(true);
  });
});
