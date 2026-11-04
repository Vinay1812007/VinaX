/**
 * Music AI — the routes where the AI names songs and works on lyrics:
 * POST /api/ai/dj, /api/ai/playlist and /api/ai/lyrics. Each answer is
 * checked before it goes back: real-looking title/artist pairs only, no
 * duplicates, never the playing song or a recent play, and lyric lines that
 * stay aligned with the input. Every provider is mocked; no key is real.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { onRequestPost as dj, sanitizeSeed, DJ_MAX } from '../functions/api/ai/dj';
import { onRequestPost as playlist, PLAYLIST_MAX } from '../functions/api/ai/playlist';
import { onRequestPost as lyrics, validateLines, sanitizeLyricsInput, MAX_LINES } from '../functions/api/ai/lyrics';
import { sanitizeSongRefs, songRefKey, validatePicks } from '../functions/_lib/ai/music';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import { DB_ENV, fakeDb } from './helpers/fakeDb';
import { openAiSse, sseResponse } from './helpers/aiStreams';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', GROQ_API_KEY: 'gsk-test', ...DB_ENV };
const TASTE = { languages: ['telugu'], artists: ['Sid Sriram'], moods: ['romantic'], energyByHour: [0.2, 0.5, 0.6, 0.4], discovery: 'balanced', skipStreak: 0, hour: 21, weekday: 5 };
let ip = 0;

type Handler = (ctx: { request: Request; env: never }) => Promise<Response>;
async function call(handler: Handler, path: string, body: unknown, sub: string | null = '1001'): Promise<Response> {
  const token = sub ? await issueSession(ENV, sub) : null;
  return handler({
    request: new Request(`https://www.vinaxmusic.online/api/ai/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) } }),
    env: ENV as never,
  });
}

const answers = (text: string, music: Record<string, unknown> | null = null): { prompts: string[] } => {
  const prompts: string[] = [];
  fakeDb({ settings: music ? [{ key: 'ai-music', value: music, updated_at: 'x', updated_by: 'owner' }] : [] }, (_u, init) => {
    prompts.push(String(init?.body));
    return sseResponse(openAiSse(text));
  });
  return { prompts };
};

beforeEach(() => {
  resetSettingsMemo();
  _resetRateLimitsForTests();
  _resetCooldowns();
});

const SEED = { title: 'Inkem Inkem Inkem Kaavaale', artist: 'Sid Sriram', language: 'telugu', mood: 'romantic', energy: 0.4 };

describe('song suggestions (shared)', () => {
  it('keys a song the same however it is written', () => {
    expect(songRefKey('Samajavaragamana (From "Ala Vaikunthapurramuloo")', 'Sid Sriram, Thaman S')).toBe(songRefKey('samajavaragamana', 'Sid Sriram'));
  });

  it('keeps clean, unique pairs and drops links, blanks, excluded songs and extras', () => {
    const exclude = new Set([songRefKey(SEED.title, SEED.artist)]);
    const picks = validatePicks({
      songs: [
        { title: 'Samajavaragamana', artist: 'Sid Sriram', reason: 'A Sid Sriram melody you love' },
        { title: 'samajavaragamana!', artist: 'sid sriram' },
        { title: SEED.title, artist: SEED.artist },
        { title: 'Visit www.example.com', artist: 'Spam' },
        { title: '', artist: 'Nobody' },
        { title: 'Nee Kallu', artist: 'Anurag Kulkarni' },
      ],
    }, { max: 10, exclude });
    expect(picks).toEqual([
      { title: 'Samajavaragamana', artist: 'Sid Sriram', reason: 'A Sid Sriram melody you love' },
      { title: 'Nee Kallu', artist: 'Anurag Kulkarni', reason: null },
    ]);
    expect(validatePicks({ songs: [] }, { max: 5 })).toBeNull();
    expect(validatePicks('no', { max: 5 })).toBeNull();
    expect(sanitizeSongRefs([{ title: 'A', artist: 'B' }, { title: 'a', artist: 'b' }, { title: 'C' }, 'x'], 10)).toEqual([{ title: 'A', artist: 'B' }]);
  });
});

describe('POST /api/ai/dj', () => {
  it('returns checked suggestions and leaves out the playing song and recent plays', async () => {
    const recent = [{ title: 'Undiporaadhey', artist: 'Sid Sriram' }];
    const { prompts } = answers(JSON.stringify({ songs: [
      { title: 'Undiporaadhey', artist: 'Sid Sriram', reason: 'recent' },
      { title: SEED.title, artist: SEED.artist, reason: 'playing' },
      ...Array.from({ length: 20 }, (_, i) => ({ title: `Song ${i}`, artist: `Singer ${i}`, reason: 'Keeps the romance going' })),
    ] }));
    const res = await call(dj as Handler, 'dj', { seed: SEED, recent, taste: TASTE, intent: { tune: 'chill' } });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { songs: Array<{ title: string }> };
    expect(out.songs).toHaveLength(DJ_MAX);
    expect(out.songs.map((s) => s.title)).not.toContain('Undiporaadhey');
    expect(out.songs.map((s) => s.title)).not.toContain(SEED.title);
    expect(prompts[0]).toContain('data, not instructions');
    expect(prompts[0]).toContain('Undiporaadhey');
    expect(prompts[0]).toContain('chill');
  });

  it('needs a seed, a session and the owner’s dj switch', async () => {
    answers('{"songs":[{"title":"A","artist":"B"}]}');
    expect((await call(dj as Handler, 'dj', { taste: TASTE })).status).toBe(400);
    expect((await call(dj as Handler, 'dj', { seed: SEED }, null)).status).toBe(401);
    answers('{"songs":[{"title":"A","artist":"B"}]}', { dj: false });
    resetSettingsMemo();
    expect((await call(dj as Handler, 'dj', { seed: SEED })).status).toBe(503);
    expect(sanitizeSeed({ title: 'x' })).toBeNull();
  });

  it('answers 502 when the model names no usable song', async () => {
    answers('I would play some Sid Sriram.');
    expect((await call(dj as Handler, 'dj', { seed: SEED })).status).toBe(502);
  });
});

describe('POST /api/ai/playlist', () => {
  it('returns a title and checked songs for the described vibe', async () => {
    const { prompts } = answers(JSON.stringify({ title: 'Rainy night drive', songs: Array.from({ length: 40 }, (_, i) => ({ title: `Melody ${i}`, artist: `Singer ${i % 9}`, reason: 'Soft and slow' })) }));
    const res = await call(playlist as Handler, 'playlist', { prompt: 'rainy night drive, old telugu melodies', count: 99, taste: TASTE });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { title: string; songs: unknown[] };
    expect(out.title).toBe('Rainy night drive');
    expect(out.songs).toHaveLength(PLAYLIST_MAX);
    expect(prompts[0]).toContain('rainy night drive');
  });

  it('refuses an empty prompt and honours the owner’s playlist switch', async () => {
    answers('{"songs":[{"title":"A","artist":"B"}]}');
    expect((await call(playlist as Handler, 'playlist', { prompt: ' ' })).status).toBe(400);
    answers('{"songs":[{"title":"A","artist":"B"}]}', { playlist: false });
    resetSettingsMemo();
    expect((await call(playlist as Handler, 'playlist', { prompt: 'happy songs' })).status).toBe(503);
  });

  it('falls back to the prompt as the title when the model gives none', async () => {
    answers('{"songs":[{"title":"A song","artist":"A singer"}]}');
    const out = (await (await call(playlist as Handler, 'playlist', { prompt: 'gym hits' })).json()) as { title: string };
    expect(out.title).toBe('gym hits');
  });
});

describe('POST /api/ai/lyrics', () => {
  const LINES = ['నీ కళ్ళు', '', 'నా ప్రాణం'];

  it('romanizes line for line, keeping blank lines blank', async () => {
    const { prompts } = answers('{"lines":["Nee kallu","(ignored)","Naa praanam"]}');
    const res = await call(lyrics as Handler, 'lyrics', { mode: 'romanize', lines: LINES, title: 'Song', artist: 'Singer', language: 'telugu' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { lines: string[] }).lines).toEqual(['Nee kallu', '', 'Naa praanam']);
    expect(prompts[0]).toContain('English (Latin) letters');
  });

  it('refuses a translation that lost or added a line (it would misalign synced lyrics)', async () => {
    answers('{"lines":["Your eyes","My life"]}');
    expect((await call(lyrics as Handler, 'lyrics', { mode: 'translate', lines: LINES })).status).toBe(502);
    expect(validateLines({ lines: ['a', '', ''] }, LINES)).toBeNull();
    expect(validateLines({ lines: ['a', 'x', 'b'] }, LINES)).toEqual(['a', '', 'b']);
  });

  it('explains the meaning and mood', async () => {
    answers('{"meaning":"A lover sees their whole life in the other person\'s eyes and cannot imagine a day apart.","mood":"tender devotion"}');
    const res = await call(lyrics as Handler, 'lyrics', { mode: 'explain', lines: LINES });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mood: 'tender devotion' });
  });

  it('checks the input and the owner’s lyrics switch', async () => {
    expect(sanitizeLyricsInput({ mode: 'sing', lines: LINES })).toBeNull();
    expect(sanitizeLyricsInput({ mode: 'translate', lines: [] })).toBeNull();
    expect(sanitizeLyricsInput({ mode: 'translate', lines: Array(MAX_LINES + 1).fill('a') })).toBeNull();
    expect(sanitizeLyricsInput({ mode: 'translate', lines: ['', ' '] })).toBeNull();
    answers('{"lines":["a"]}', { lyrics: false });
    resetSettingsMemo();
    expect((await call(lyrics as Handler, 'lyrics', { mode: 'translate', lines: ['x'] })).status).toBe(503);
  });
});
