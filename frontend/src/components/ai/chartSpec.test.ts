import { describe, expect, it } from 'vitest';
import { fmtNum, parseChartSpec } from './chartSpec';

describe('```chart spec parser (v5.11.0)', () => {
  it('parses the documented shape', () => {
    const spec = parseChartSpec(
      JSON.stringify({ type: 'line', title: 'Streams', labels: ['Mon', 'Tue'], series: [{ name: 'A', data: [1, 2] }] }),
    );
    expect(spec?.type).toBe('line');
    expect(spec?.labels).toEqual(['Mon', 'Tue']);
    expect(spec?.series[0].data).toEqual([1, 2]);
  });

  it('accepts the {labels, data} shorthand and defaults to bar', () => {
    const spec = parseChartSpec('{"labels":["a","b","c"],"data":[3,"4",5]}');
    expect(spec?.type).toBe('bar');
    expect(spec?.series).toHaveLength(1);
    expect(spec?.series[0].data).toEqual([3, 4, 5]);
  });

  it('pads missing labels and short series so every point has an x', () => {
    const spec = parseChartSpec('{"labels":["q1"],"series":[{"name":"s","data":[1,2,3]},{"name":"t","data":[9]}]}');
    expect(spec?.labels).toEqual(['q1', '2', '3']);
    expect(spec?.series[1].data).toEqual([9, 0, 0]);
  });

  it('returns null for junk, an unknown shape, or no numbers (renderer falls back to code)', () => {
    expect(parseChartSpec('not json')).toBeNull();
    expect(parseChartSpec('{"type":"bar"}')).toBeNull();
    expect(parseChartSpec('{"labels":["a"],"data":["x"]}')).toBeNull();
    expect(parseChartSpec('[1,2,3]')).toBeNull();
  });

  it('formats compact tick numbers with the unit in the right place', () => {
    expect(fmtNum(1500000)).toBe('1.5M');
    expect(fmtNum(42, '%')).toBe('42%');
    expect(fmtNum(2500, '₹')).toBe('₹2500');
    expect(fmtNum(12000, '₹')).toBe('₹12.0K');
  });
});
