// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/downloads', () => ({ getOfflineUrl: () => null }));
const { orderedSources, recoveryAction } = await import('./engine');

const song = (qualities: string[]): Song =>
  ({ audio: qualities.map((quality, i) => ({ quality, url: String.fromCharCode(97 + i) })) } as unknown as Song);

describe('orderedSources', () => {
  const s = song(['48kbps', '160kbps', '320kbps']); // a=48 b=160 c=320

  it('high preference puts the highest bitrate first', () => {
    expect(orderedSources(s, 'high')[0]).toBe('c');
  });
  it('medium targets ~160 kbps', () => {
    expect(orderedSources(s, 'medium')[0]).toBe('b');
  });
  it('low targets ~96 kbps (nearest)', () => {
    expect(orderedSources(s, 'low')[0]).toBe('a');
  });
  it('returns [] when there are no audio variants', () => {
    expect(orderedSources(song([]), 'high')).toEqual([]);
  });
  it('drops variants without a URL', () => {
    const t = { audio: [{ quality: '320kbps', url: '' }, { quality: '160kbps', url: 'x' }] } as unknown as Song;
    expect(orderedSources(t, 'high')).toEqual(['x']);
  });
});

describe('recoveryAction (network-drop / handoff recovery)', () => {
  it('retries the same source once when it had been playing fine', () => {
    expect(recoveryAction(true, false)).toBe('retry-same');
  });
  it('advances after the one retry is spent', () => {
    expect(recoveryAction(true, true)).toBe('advance');
  });
  it('advances immediately for a source that never played', () => {
    expect(recoveryAction(false, false)).toBe('advance');
    expect(recoveryAction(false, true)).toBe('advance');
  });
});
