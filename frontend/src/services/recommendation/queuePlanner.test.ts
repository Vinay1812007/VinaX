// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate } from './types';
import type { Song } from '@/types';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false, platformName: () => 'web', haptic: () => undefined }));
vi.mock('@/services/personalization/updater', () => ({ recordFavorite: () => undefined }));

const song = (id: string, title: string, artist: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: { id: `al-${id}`, name: `Album ${id}` }, images: [], audio: [],
  duration: 240, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: null, ...extra,
});
const pool: Candidate[] = [
  { song: song('1', 'Party blast', 'A', { energy: 0.9 }), source: 'related' },
  { song: song('2', 'Soft melody', 'B', { energy: 0.3 }), source: 'related' },
  { song: song('3', 'Dance mass', 'C', { energy: 0.85 }), source: 'trending' },
  { song: song('4', 'Calm night', 'D', { energy: 0.25 }), source: 'favorite-artist' },
  { song: song('5', 'Mid tempo', 'E', { energy: 0.55 }), source: 'explore' },
  { song: song('6', 'Hindi hit', 'F', { energy: 0.6, language: 'hindi' }), source: 'related' },
  { song: song('7', 'Explicit one', 'G', { energy: 0.7, explicit: true }), source: 'related' },
  { song: song('8', 'Short clip', 'H', { duration: 40 }), source: 'related' },
  { song: song('9', 'Another mid', 'I', { energy: 0.5 }), source: 'related' },
  { song: song('10', 'One more', 'J', { energy: 0.45 }), source: 'related' },
];
vi.mock('./candidates', () => ({ gatherCandidates: async () => pool, generateNextCandidates: async () => pool.slice(0, 3) }));
vi.mock('@/services/ai/recommendations', () => ({ enrichSongs: async (s: Song[]) => s, requestCurator: async () => null, classifySongs: async () => [], applyMetadata: (s: Song[]) => s, aiRerankSongs: async (s: Song[]) => s }));

import { admitForPlan, planQueue } from './queuePlanner';
import { useSettingsStore } from '@/store/settingsStore';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useSettingsStore.setState({ pinnedLanguages: ['telugu'], mutedLanguages: [], aiDj: false, kidMode: false });
});

describe('admitForPlan', () => {
  it('applies the language lock, mood filter and the standard gates', () => {
    const base = { shape: 'steady' as const, minutes: 30, discovery: 'medium' as const };
    const locked = admitForPlan(pool, { ...base, language: 'telugu' }, { muted: [], blocked: () => false, recentKeys: new Set() });
    expect(locked.map((c) => c.song.id)).not.toContain('6'); // hindi
    expect(locked.map((c) => c.song.id)).not.toContain('8'); // 40 s clip
    const energetic = admitForPlan(pool, { ...base, mood: 'energetic' }, { muted: [], blocked: () => false, recentKeys: new Set() });
    expect(energetic.map((c) => c.song.id)).toEqual(expect.arrayContaining(['1', '3']));
    expect(energetic.map((c) => c.song.id)).not.toContain('2'); // chill title
    const blocked = admitForPlan(pool, base, { muted: ['telugu'], blocked: () => false, recentKeys: new Set() });
    expect(blocked.map((c) => c.song.id)).toEqual(['6']);
  });
});

describe('planQueue', () => {
  it('lays out a duration-bounded arc from real candidates and never touches the queue', async () => {
    const plan = await planQueue({ seed: null, shape: 'build', minutes: 12, discovery: 'medium', language: 'telugu' });
    expect(plan.candidates).toBeGreaterThan(4);
    expect(plan.songs.length).toBeGreaterThanOrEqual(3);
    expect(plan.totalSec).toBeGreaterThanOrEqual(12 * 60);
    expect(plan.totalSec).toBeLessThan(12 * 60 + 300);
    expect(plan.songs.every((s) => s.song.language === 'telugu')).toBe(true);
    expect(plan.songs.every((s) => typeof s.why === 'string' && s.why.length > 0)).toBe(true);
    expect(plan.intro).toBeNull();
    expect(plan.djTouched).toBe(false);
  });
  it('returns an empty plan when nothing is admissible', async () => {
    const plan = await planQueue({ seed: null, shape: 'steady', minutes: 30, discovery: 'low', language: 'tamil' });
    expect(plan.songs).toEqual([]);
    expect(plan.candidates).toBe(0);
  });
});
