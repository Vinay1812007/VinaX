// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { applyMetadata, classifySongs } from './recommendations';

const song: Song = {
  kind: 'song', id: 's1', title: 'Track', subtitle: 'Artist', artists: [{ id: 'a1', name: 'Artist' }],
  album: null, images: [], audio: [], duration: 180, language: null, year: null, explicit: false,
  hasLyrics: true, playCount: null,
};

beforeEach(() => localStorage.clear());

describe('AI recommendation adapter', () => {
  it('merges metadata without changing the stable Song contract', () => {
    const enriched = applyMetadata([song], [{ id: 's1', dialect: 'Coastal', genre: ['film'], vibe: ['warm'], energy: 0.7, tempo: 112 }])[0];
    expect(enriched.language).toBeNull();
    expect(enriched.dialect).toBe('Coastal');
    expect(enriched.genres).toContain('film');
    expect(enriched.energy).toBe(0.7);
  });

  it('falls back to cached/empty metadata when the AI endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(classifySongs([song])).resolves.toEqual([]);
  });
});
