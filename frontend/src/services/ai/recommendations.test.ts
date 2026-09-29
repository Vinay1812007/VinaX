// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { applyMetadata, classifySongs, resetCuratorBackoff } from './recommendations';

const song: Song = {
  kind: 'song', id: 's1', title: 'Track', subtitle: 'Artist', artists: [{ id: 'a1', name: 'Artist' }],
  album: null, images: [], audio: [], duration: 180, language: null, year: null, explicit: false,
  hasLyrics: true, playCount: null,
};

beforeEach(() => { localStorage.clear(); resetCuratorBackoff(); vi.unstubAllGlobals(); });

/** Answer every curate call with `songs` rows. */
function curator(songs: unknown[]) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { songs } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const measuredSong: Song = { ...song, id: 'm1', title: 'Measured', energy: 0.62, tempo: 118 };
const plainSong: Song = { ...song, id: 'p1', title: 'Plain' };

describe('AI recommendation adapter', () => {
  it('merges metadata without changing the stable Song contract', () => {
    const enriched = applyMetadata([song], [{ id: 's1', dialect: 'Coastal', genre: ['film'], vibe: ['warm'], energy: 0.7, tempo: 112 }])[0];
    expect(enriched.language).toBeNull();
    expect(enriched.dialect).toBe('Coastal');
    expect(enriched.genres).toContain('film');
    expect(enriched.energy).toBe(0.7);
  });

  it('8.2.0 — a switched-off or over-budget curator is left alone for ten minutes, not re-asked every 30 s', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"ai_over_budget"}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await expect(classifySongs([song])).resolves.toEqual([]);
      const calls = fetchMock.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      clock.mockReturnValue(now + 5 * 60_000);
      await classifySongs([{ ...song, id: 's-later' }]);
      expect(fetchMock.mock.calls.length).toBe(calls);
    } finally {
      clock.mockRestore();
    }
  });

  it('falls back to cached/empty metadata when the AI endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(classifySongs([song])).resolves.toEqual([]);
  });
});

describe('AI metadata provenance (7.2.0)', () => {
  it('drops an energy/tempo the server did not mark as supplied (an older server, or an invented value)', async () => {
    curator([{ id: 'p1', mood: 'chill', energy: 0.8, tempo: 128 }]);
    const [row] = await classifySongs([plainSong]);
    expect(row.mood).toBe('chill');
    expect(row.energy).toBeUndefined();
    expect(row.tempo).toBeUndefined();
    expect(applyMetadata([plainSong], [row])[0].energy).toBeUndefined();
  });

  it('keeps a measurement the server marked supplied only when it equals what this client sent', async () => {
    curator([{ id: 'm1', energy: 0.62, tempo: 118, supplied: ['energy', 'tempo'], inferred: ['mood'] }]);
    const [row] = await classifySongs([measuredSong]);
    expect(row.energy).toBe(0.62);
    expect(row.tempo).toBe(118);
    expect(row.supplied).toEqual(['energy', 'tempo']);
    expect(row.inferred).toEqual(['mood']);
  });

  it('refuses a "supplied" measurement that differs from what was sent, or that was never sent', async () => {
    curator([
      { id: 'm1', energy: 0.95, tempo: 118, supplied: ['energy', 'tempo'] },
      { id: 'p1', energy: 0.4, supplied: ['energy'] },
    ]);
    const rows = await classifySongs([measuredSong, plainSong]);
    const m1 = rows.find((r) => r.id === 'm1');
    const p1 = rows.find((r) => r.id === 'p1');
    expect(m1?.energy).toBeUndefined();
    expect(m1?.tempo).toBe(118);
    expect(m1?.supplied).toEqual(['tempo']);
    expect(p1?.energy).toBeUndefined();
    expect(p1?.supplied).toEqual([]);
  });

  it('keeps only known field names in the inferred / supplied labels', async () => {
    curator([{ id: 'p1', mood: 'chill', inferred: ['mood', 'energy', '<b>', 7], supplied: ['energy', 'mood'] }]);
    const [row] = await classifySongs([plainSong]);
    expect(row.inferred).toEqual(['mood']);
    expect(row.supplied).toEqual([]);
  });

  it('never reads the v2 cache (it may hold invented energies) and removes it', async () => {
    const fingerprint = JSON.stringify([plainSong.title, plainSong.subtitle, plainSong.language, plainSong.artists.map((a) => a.name), plainSong.album?.name]);
    localStorage.setItem('vinax.recommendation.ai-metadata.v2', JSON.stringify({ p1: { at: Date.now() - 1000, fingerprint, metadata: { id: 'p1', energy: 0.9, tempo: 150, mood: 'energetic' } } }));
    const fetchMock = curator([]);
    const rows = await classifySongs([plainSong]);
    expect(rows).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the v2 entry was not treated as a cache hit
    expect(localStorage.getItem('vinax.recommendation.ai-metadata.v2')).toBeNull();
  });

  it('a confirmed measurement survives the v3 cache round trip', async () => {
    curator([{ id: 'm1', energy: 0.62, supplied: ['energy'] }]);
    await classifySongs([measuredSong]);
    const fetchMock = curator([]);
    const [again] = await classifySongs([measuredSong]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(again.energy).toBe(0.62);
    expect(JSON.parse(localStorage.getItem('vinax.recommendation.ai-metadata.v3') ?? '{}').m1.metadata.supplied).toEqual(['energy']);
  });
});
