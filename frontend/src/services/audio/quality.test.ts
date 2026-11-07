import { describe, expect, it } from 'vitest';
import { orderByQuality } from './quality';
import { qualityLevel, QUALITY_LEVELS } from './qualityLevels';

const v = (q: string) => ({ quality: q, url: q });
const ladder = [v('12kbps'), v('48kbps'), v('96kbps'), v('160kbps'), v('320kbps')];

describe('1.11 — sound-quality levels', () => {
  it('four levels, labelled for people, with the stored ids unchanged', () => {
    expect(QUALITY_LEVELS.map((l) => [l.value, l.label, l.kbps])).toEqual([
      ['saver', 'Low', 48],
      ['low', 'Medium', 96],
      ['medium', 'High', 160],
      ['high', 'Very high', 320],
    ]);
  });

  it('each level takes its own bitrate first, then the nearest', () => {
    expect(orderByQuality(ladder, 'saver')[0].quality).toBe('48kbps');
    expect(orderByQuality(ladder, 'low')[0].quality).toBe('96kbps');
    expect(orderByQuality(ladder, 'medium')[0].quality).toBe('160kbps');
    expect(orderByQuality(ladder, 'high').map((x) => x.quality)).toEqual(['320kbps', '160kbps', '96kbps', '48kbps', '12kbps']);
  });

  it('a missing bitrate falls back to the closest one (higher wins a tie)', () => {
    const gappy = [v('48'), v('160'), v('320')];
    expect(orderByQuality(gappy, 'low').map((x) => x.quality)).toEqual(['48', '160', '320']);
    expect(orderByQuality([v('96'), v('320')], 'medium')[0].quality).toBe('96');
  });

  it('an unknown id reads as the top level', () => {
    expect(qualityLevel('nope' as never).label).toBe('Very high');
  });
});
