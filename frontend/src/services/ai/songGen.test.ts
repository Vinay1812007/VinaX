// @vitest-environment jsdom
/**
 * "Generate a song like this" on the device: what is sent (the feel, never
 * the song's title, artist, lyrics or audio), Kid mode, the check of the
 * listener's own words, the label every surface shows, and a job from start
 * to the finished song. Also: a generated song teaches the taste profile
 * nothing and never reaches the usage statistics.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';

vi.mock('@/services/auth/google', () => ({ currentAccount: () => ({ session: 'session-token' }) }));

import { useSettingsStore } from '@/store/settingsStore';
import { GENERATED_SUBTITLE, generateLike, generationInputFor, isGeneratedSong, promptNamesKnownWork, recentGenerated, resetSongGen, toGeneratedSong } from './songGen';
import { songPath } from '@/utils/slug';

const source = makeSong('src', { title: 'Secret Source Title', artist: 'Secret Singer', language: 'telugu', genre: 'Film', duration: 245, energy: 0.8 });

beforeEach(() => {
  localStorage.clear();
  resetSongGen();
  useSettingsStore.setState({ kidMode: false });
});
afterEach(() => vi.unstubAllGlobals());

describe('what is sent', () => {
  it('the feel of the song only, its length kept to 30–180 seconds', () => {
    const input = generationInputFor(source);
    expect(input).toEqual({ mood: expect.any(String), energy: 0.8, tempo: 134, genre: 'film', language: 'telugu', durationSec: 180, instrumental: false, kid: false });
    expect(JSON.stringify(input)).not.toMatch(/Secret|src/);
    expect(generationInputFor({ ...source, duration: 12 }).durationSec).toBe(30);
  });

  it('Kid mode: instrumental only, and none of the listener’s own words', () => {
    useSettingsStore.setState({ kidMode: true });
    const input = generationInputFor(source, { instrumental: false, promptText: 'rainy day' });
    expect(input.instrumental).toBe(true);
    expect(input.kid).toBe(true);
    expect(input).not.toHaveProperty('promptText');
  });

  it('refuses words that name the playing song or its artists', () => {
    expect(promptNamesKnownWork('something like secret singer', source)).toBe(true);
    expect(promptNamesKnownWork('a twist on Secret Source Title', source)).toBe(true);
    expect(promptNamesKnownWork('warm flute on a rainy evening', source)).toBe(false);
  });
});

describe('the finished song', () => {
  it('is labelled "AI generated" wherever a song’s subtitle shows, and opens in the player', () => {
    const song = toGeneratedSong('11111111-1111-4111-8111-111111111111', { status: 'done', progress: 1, title: 'Monsoon Lanterns', durationSec: 120, audioUrl: '/api/ai/generate-song/x/audio' }, { mood: 'chill', language: 'telugu', instrumental: false });
    expect(isGeneratedSong(song)).toBe(true);
    expect(song.subtitle).toBe(GENERATED_SUBTITLE);
    expect(song.subtitle).toContain('AI generated');
    expect(song.artists[0].name).toBe('AI generated');
    expect(song.audio[0].url).toMatch(/^https?:\/\/.+\/api\/ai\/generate-song\/x\/audio$/);
    expect(songPath(song)).toBe('/now-playing');
    expect(song.generated?.jobId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('a job from start to finish, with the device id and the session, remembered for Home', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let polls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST') return new Response(JSON.stringify({ jobId: 'job-1', status: 'queued', progress: 0, remaining: 4 }), { status: 202 });
      polls += 1;
      return new Response(JSON.stringify(polls < 2 ? { status: 'running', progress: 0.5, durationSec: 120 } : { status: 'done', progress: 1, title: 'Easy Evening', durationSec: 120, audioUrl: '/api/ai/generate-song/job-1/audio', expiresAt: Date.now() + 1e6 }), { status: 200 });
    }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const result = await generateLike(source, { durationSec: 120 });
    vi.useRealTimers();
    expect('song' in result && result.song.title).toBe('Easy Evening');
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect((post.init!.headers as Record<string, string>).authorization).toBe('Bearer session-token');
    expect((post.init!.headers as Record<string, string>)['x-vinax-device']).toBeTruthy();
    expect(String(post.init!.body)).not.toMatch(/Secret/);
    expect(recentGenerated().map((s) => s.title)).toEqual(['Easy Evening']);
  });

  it('says why it could not start, and never calls the network for words naming the song', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'quota_exceeded' }), { status: 429 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await generateLike(source, { promptText: 'like Secret Singer' })).toEqual({ error: 'prompt_names_artist' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await generateLike(source)).toEqual({ error: 'quota_exceeded' });
  });
});

describe('a generated song and the rest of VinaX', () => {
  it('teaches the taste profile nothing', async () => {
    const { recordPlay, recordFavorite } = await import('@/services/personalization/updater');
    const { loadProfile } = await import('@/services/personalization/storage');
    const before = JSON.stringify(loadProfile().artists);
    const song = toGeneratedSong('j', { status: 'done', progress: 1, audioUrl: '/a' }, { mood: 'chill', language: 'telugu', instrumental: false });
    recordPlay(song);
    recordFavorite(song, true);
    await new Promise((r) => setTimeout(r, 20));
    expect(JSON.stringify(loadProfile().artists)).toBe(before);
  });
});
