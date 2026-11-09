import { describe, expect, it } from 'vitest';
import { autoQuality, orderByQuality, resolveStreamQuality } from './quality';
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

describe('1.12 — Auto follows the connection', () => {
  it('Wi-Fi gets the best, 4G High, 3G Medium, 2G or data saver Low, and a silent browser High', () => {
    expect(autoQuality({ type: 'wifi', effectiveType: '4g' })).toBe('high');
    expect(autoQuality({ type: 'ethernet' })).toBe('high');
    expect(autoQuality({ type: 'cellular', effectiveType: '4g' })).toBe('medium');
    expect(autoQuality({ effectiveType: '3g' })).toBe('low');
    expect(autoQuality({ effectiveType: '2g' })).toBe('saver');
    expect(autoQuality({ effectiveType: 'slow-2g', type: 'wifi' })).toBe('saver');
    expect(autoQuality({ saveData: true, type: 'wifi', effectiveType: '4g' })).toBe('saver');
    expect(autoQuality({})).toBe('medium');
    expect(resolveStreamQuality('high')).toBe('high');
    expect(['saver', 'low', 'medium', 'high']).toContain(resolveStreamQuality('auto'));
  });
});
