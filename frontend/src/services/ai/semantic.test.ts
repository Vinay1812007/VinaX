import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

const model = vi.hoisted(() => ({
  query: null as { model: string; vector: Float32Array } | null,
  songs: new Map<string, Float32Array>(),
  active: null as string | null,
}));

vi.mock('./embeddings', async (importActual) => {
  const actual = await importActual<typeof import('./embeddings')>();
  return {
    cosine: actual.cosine,
    activeEmbeddingModel: () => model.active,
    embedQueryDetailed: async () => model.query,
    embedSongs: async () => undefined,
    getCachedEmbedding: (id: string) => model.songs.get(id) ?? null,
  };
});

import { intentAdjust, rankLocally, semanticRank } from './semantic';
import { parseMusicIntent } from './musicIntent';

const song = (id: string, over: Partial<Song> = {}): Song =>
  ({ kind: 'song', id, title: id, subtitle: '', artists: [], album: null, images: [], audio: [], duration: null, language: null, year: null, explicit: false, hasLyrics: false, playCount: null, ...over }) as Song;

const unit = (...xs: number[]): Float32Array => {
  const n = Math.hypot(...xs);
  return new Float32Array(xs.map((x) => x / n));
};

beforeEach(() => {
  model.query = null;
  model.songs.clear();
  model.active = null;
});

describe('semanticRank — on-device space', () => {
  it('ranks by the request when no engine answers, named language first', async () => {
    const songs = [
      song('hindi-party', { language: 'hindi', title: 'Party Song', energy: 0.9 }),
      song('telugu-sad', { language: 'telugu', mood: 'melancholy' }),
      song('telugu-dance', { language: 'telugu', mood: 'energetic' }),
    ];
    const out = await semanticRank('sad telugu songs for rain', songs, { leashMs: 50 });
    expect(out.map((x) => x.song.id)).toEqual(['telugu-sad', 'telugu-dance', 'hindi-party']);
    expect(out.every((x) => x.space === 'local')).toBe(true);
  });

  it('lifts energetic songs for a workout request', () => {
    const intent = parseMusicIntent('telugu workout songs');
    expect(intentAdjust(song('a', { language: 'telugu', energy: 0.9 }), intent)).toBeGreaterThan(intentAdjust(song('b', { language: 'telugu', energy: 0.2 }), intent));
  });

  it('rankLocally is synchronous and total', () => {
    expect(rankLocally('chill hindi', [song('x'), song('y', { language: 'hindi' })])[0].song.id).toBe('y');
  });
});

describe('semanticRank — model space', () => {
  it('uses server vectors when the query and songs share the active model', async () => {
    model.active = 'm';
    model.query = { model: 'm', vector: unit(1, 0, 0) };
    model.songs.set('near', unit(0.9, 0.1, 0));
    model.songs.set('far', unit(0, 1, 0));
    const out = await semanticRank('rainy evening', [song('far'), song('near'), song('unembedded')]);
    expect(out.map((x) => [x.song.id, x.space])).toEqual([
      ['near', 'model'],
      ['far', 'model'],
      ['unembedded', 'local'],
    ]);
  });

  it('never compares a query from another model with the cached vectors', async () => {
    model.active = 'm2';
    model.query = { model: 'm1', vector: unit(1, 0, 0) };
    model.songs.set('a', unit(1, 0, 0));
    const out = await semanticRank('rainy evening', [song('a')]);
    expect(out[0].space).toBe('local');
  });
});
