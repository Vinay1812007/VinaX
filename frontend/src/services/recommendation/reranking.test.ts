import { describe, expect, it } from 'vitest';
import type { RecommendationContext, ScoredCandidate } from './types';
import type { Song } from '@/types';
import { createEmptyProfile } from '@/services/personalization/profile';
import { rerankCandidates } from './reranking';

const song = (id: string, artist: string): Song => ({
  kind: 'song', id, title: id, subtitle: artist, artists: [{ id: artist, name: artist }],
  album: null, images: [], audio: [], duration: 180, language: 'english', year: null,
  explicit: false, hasLyrics: true, playCount: 10,
});
const ctx: RecommendationContext = { profile: createEmptyProfile(), hour: 12, region: null, pinnedLanguages: [], mutedLanguages: [], intensity: 0.7, favorites: [], history: [], salt: 1 };

describe('recommendation diversity re-ranking', () => {
  it('avoids repeating the same artist when relevance is close', () => {
    const items: ScoredCandidate[] = [
      { candidate: { song: song('a1', 'A'), source: 'trending' }, score: 1, reasons: [] },
      { candidate: { song: song('a2', 'A'), source: 'trending' }, score: 0.99, reasons: [] },
      { candidate: { song: song('b1', 'B'), source: 'explore' }, score: 0.96, reasons: [] },
    ];
    const ranked = rerankCandidates(items, ctx, 3);
    expect(ranked[0].candidate.song.id).toBe('a1');
    expect(ranked[1].candidate.song.id).not.toBe('a2');
  });
});
