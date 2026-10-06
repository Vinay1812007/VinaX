import { describe, expect, it } from 'vitest';
import { ACCENT_OPTIONS, normalizeAccent } from './accents';

describe('accent picker options', () => {
  it("shows the default accent as the app style's own colour, and keeps Marigold as a choice", () => {
    const def = ACCENT_OPTIONS.find((a) => a.id === normalizeAccent(undefined));
    expect(def).toMatchObject({ id: 'crimson', label: 'Style colour' });
    expect(ACCENT_OPTIONS[0].id).toBe('crimson');
    expect(ACCENT_OPTIONS.find((a) => a.id === 'marigold')).toEqual({ id: 'marigold', label: 'Marigold', dot: 'rgb(255 164 46)' });
  });

  it("labels the older orange 'ember' accent Copper so the two never read as duplicates", () => {
    expect(ACCENT_OPTIONS.find((a) => a.id === 'ember')?.label).toBe('Copper');
    const labels = ACCENT_OPTIONS.map((a) => a.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('keeps every stored id, so existing settings still resolve', () => {
    expect(ACCENT_OPTIONS.map((a) => a.id)).toEqual(['crimson', 'marigold', 'ember', 'sunset', 'gold', 'emerald', 'ocean', 'azure', 'violet', 'rose', 'mono']);
    for (const a of ACCENT_OPTIONS) expect(normalizeAccent(a.id)).toBe(a.id);
  });
});
