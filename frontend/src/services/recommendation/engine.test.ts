// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import type { Candidate, RecommendationContext } from './types';

vi.mock('./candidates', () => ({ gatherCandidates: vi.fn() }));
vi.mock('./mixes', () => ({ buildMixes: vi.fn() }));
vi.mock('./scoring', () => ({
  rankCandidates: (items: Candidate[]) =>
    items.map((candidate) => ({ candidate, score: 1, reasons: [] })),
  scoreCandidate: (candidate: Candidate) => ({ candidate, score: 1, reasons: [] }),
}));
vi.mock('@/services/ai/dj', () => ({ aiSimilarSongs: vi.fn().mockResolvedValue([]) }));
vi.mock('@/services/api', () => ({ getSongSuggestions: vi.fn(), searchSongsPage: vi.fn() }));

import { similarToSong } from './engine';
import { getSongSuggestions, searchSongsPage } from '@/services/api';
import { recordServed, songKey } from './flow';

const track = (id: string, title = id, language = 'telugu', artist = 'Artist'): Song => ({
  kind: 'song',
  id,
  title,
  language,
  artists: [{ id: artist, name: artist }],
  subtitle: artist,
  album: null,
  images: [],
  audio: [],
  duration: 200,
  year: null,
  explicit: false,
  hasLyrics: false,
  playCount: null,
});
const context = (seed: Song): RecommendationContext => ({
  coPlaySeed: seed,
  history: [],
  favorites: [],
  salt: 39,
  intensity: 0.65,
  pinnedLanguages: ['telugu'],
  mutedLanguages: ['hindi'],
  hour: 12,
  region: null,
  profile: {} as RecommendationContext['profile'],
});
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('local continuation when AI returns no songs', () => {
  it('expands the catalog but excludes seed versions, queued IDs, served tracks and wrong languages', async () => {
    const seed = track('seed', 'Orbit');
    recordServed([songKey(track('served', 'Yesterday'))]);
    vi.mocked(getSongSuggestions).mockResolvedValue([
      track('remaster', 'Orbit (2025 Remaster)'),
      track('queued'),
      track('old-release', 'Yesterday'),
      track('wrong', 'Wrong', 'hindi'),
      track('good'),
    ]);
    vi.mocked(searchSongsPage).mockResolvedValue([
      track('new-catalog', 'Discovery', 'telugu', 'Another artist'),
    ]);
    const result = await similarToSong(seed.id, context(seed), new Set(['queued']));
    expect(new Set(result.map((s) => s.candidate.song.id))).toEqual(
      new Set(['good', 'new-catalog']),
    );
    expect(searchSongsPage).toHaveBeenCalledWith(expect.any(String), 4, 30);
  });
  it('retains valid catalog results when the related-song provider fails', async () => {
    const seed = track('seed');
    vi.mocked(getSongSuggestions).mockRejectedValue(new Error('provider unavailable'));
    vi.mocked(searchSongsPage).mockResolvedValue([track('new-catalog')]);
    expect((await similarToSong(seed.id, context(seed))).map((s) => s.candidate.song.id)).toEqual([
      'new-catalog',
    ]);
  });
});
