import { describe, expect, it } from 'vitest';
import { ACCENT_OPTIONS, normalizeAccent } from './accents';

describe('accent picker options (10.0 Marigold)', () => {
  it('shows the default accent as Marigold, with a marigold swatch', () => {
    const def = ACCENT_OPTIONS.find((a) => a.id === normalizeAccent(undefined));
    expect(def).toEqual({ id: 'crimson', label: 'Marigold', dot: 'rgb(255 164 46)' });
    expect(ACCENT_OPTIONS[0].id).toBe('crimson');
  });

  it("labels the older orange 'ember' accent Copper so the two never read as duplicates", () => {
    expect(ACCENT_OPTIONS.find((a) => a.id === 'ember')?.label).toBe('Copper');
    const labels = ACCENT_OPTIONS.map((a) => a.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('keeps every stored id, so existing settings still resolve', () => {
    expect(ACCENT_OPTIONS.map((a) => a.id)).toEqual(['crimson', 'ember', 'sunset', 'gold', 'emerald', 'ocean', 'azure', 'violet', 'rose', 'mono']);
    for (const a of ACCENT_OPTIONS) expect(normalizeAccent(a.id)).toBe(a.id);
  });
});
