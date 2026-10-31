// @vitest-environment jsdom
/**
 * The personal engine's client: answers are checked before use, a 204 is
 * "no page", errors carry the server's code, and a song record becomes the
 * app's own Song (and back into facts for the reporter).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { makeSong } from '@/__fixtures__/songs';
import { setLocal } from '@/services/storage/local';
import { useSettingsStore } from '@/store/settingsStore';
import { buildPersonalPlaylist, fetchPersonalHome, fetchPersonalRecommendations, PersonalError, personalEnabled, personalNotice } from './api';
import { factsOf, personalHomeOf, personalSongOf, toSong } from './types';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const song = (id: string) => ({ id, title: `Song ${id}`, artist: 'Sid Sriram', artistId: 'ar1', artists: [{ id: 'ar1', name: 'Sid Sriram' }], album: 'Album', albumId: 'al1', language: 'telugu', year: 2024, duration: 240, image: 'https://img.example/500x500.jpg', facets: { mood: 'romantic' }, reason: 'Because you listen to Sid Sriram' });
const page = () => ({ generatedAt: '2026-10-31T12:00:00.000Z', expiresAt: '2026-10-31T12:30:00.000Z', greeting: 'Good evening', shelves: [{ key: 'made-for-you', title: 'Made for you', reason: 'why', songs: [song('a'), song('b'), { id: 'bad' }] }, { key: 'empty', title: 'Empty', reason: '', songs: [] }], model: 'groq:x', tasteVersion: 4, cached: false });

describe('the personal client', () => {
  beforeEach(() => {
    localStorage.clear();
    setLocal(KEYS.account, { session: 'vx1.p.s', user: { name: 'Asha', email: 'a@x', picture: null, username: null } });
    useSettingsStore.setState({ personalEngine: true, kidMode: false });
  });
  afterEach(() => vi.restoreAllMocks());

  it('says when the engine is on for this device', () => {
    expect(personalEnabled()).toBe(true);
    useSettingsStore.setState({ kidMode: true });
    expect(personalEnabled()).toBe(false);
    useSettingsStore.setState({ kidMode: false, personalEngine: false });
    expect(personalEnabled()).toBe(false);
    useSettingsStore.setState({ personalEngine: true });
    localStorage.clear();
    expect(personalEnabled()).toBe(false);
  });

  it('fetches the page with the local clock and the session, and keeps only the songs and shelves that check out', async () => {
    const f = vi.fn(async () => json(page()));
    const got = await fetchPersonalHome({ fresh: true, mode: 'discover', fetchImpl: f as unknown as typeof fetch });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^\/api\/personal\/home\?hour=\d+&dow=\d&fresh=1&mode=discover$/);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer vx1.p.s');
    expect(got?.shelves).toHaveLength(1);
    expect(got?.shelves[0].songs.map((s) => s.id)).toEqual(['a', 'b']);
    expect(got?.greeting).toBe('Good evening');
    expect(got?.model).toBe('groq:x');
  });

  it('a 204 is no page; an error carries the server code; a bad answer is bad_answer', async () => {
    expect(await fetchPersonalHome({ fetchImpl: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch })).toBeNull();
    await expect(fetchPersonalHome({ fetchImpl: (async () => json({ error: 'personal_disabled' }, 503)) as unknown as typeof fetch })).rejects.toMatchObject({ status: 503, code: 'personal_disabled' });
    await expect(fetchPersonalHome({ fetchImpl: (async () => json({ shelves: [] })) as unknown as typeof fetch })).rejects.toBeInstanceOf(PersonalError);
    localStorage.clear();
    await expect(fetchPersonalHome()).rejects.toMatchObject({ code: 'signed_out' });
    expect(personalNotice('nothing_found')).toMatch(/Nothing in the catalogue/);
  });

  it('builds a playlist and reads recommendations', async () => {
    const f = vi.fn(async (url: string) => (url.includes('/playlist') ? json({ id: 'p1', title: 'Rainy', description: 'd', songs: [song('a')], plan: { title: 'Rainy', languages: ['telugu'], moods: [], artists: [], eras: [], energy: 'any', familiarity: 'mixed', queries: ['x'] }, model: null, generatedAt: 'now' }) : json({ seed: 's', songs: [song('b'), 7] })));
    const built = await buildPersonalPlaylist('rainy evening', { count: 10, fetchImpl: f as unknown as typeof fetch });
    expect(built.title).toBe('Rainy');
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ prompt: 'rainy evening', count: 10 });
    const recs = await fetchPersonalRecommendations({ seed: 's', limit: 5, exclude: ['x', 'y'], fetchImpl: f as unknown as typeof fetch });
    expect(recs.map((s) => s.id)).toEqual(['b']);
    expect((f.mock.calls[1] as unknown as [string])[0]).toMatch(/\/recommend\?limit=5&hour=\d+&seed=s&exclude=x%2Cy$/);
  });
});

describe('song records', () => {
  it('a record becomes the app\'s Song with artwork, no audio, and the facets', () => {
    const rec = personalSongOf(song('a'))!;
    const s = toSong(rec);
    expect(s).toMatchObject({ kind: 'song', id: 'a', title: 'Song a', subtitle: 'Sid Sriram', language: 'telugu', year: '2024', duration: 240, audio: [], mood: 'romantic', album: { id: 'al1', name: 'Album' } });
    expect(s.images[0]).toEqual({ quality: '500x500', url: 'https://img.example/500x500.jpg' });
    expect(s.artists).toEqual([{ id: 'ar1', name: 'Sid Sriram' }]);
    expect(personalSongOf({ id: 'x' })).toBeNull();
    expect(personalSongOf({ id: 'x', title: 'T', artist: 'A', image: 'javascript:alert(1)' })!.image).toBeNull();
  });

  it('a Song becomes the facts the reporter sends', () => {
    const f = factsOf(makeSong('s1', { artist: 'Arijit', album: { id: 'al', name: 'Film' }, images: [{ quality: '150x150', url: 'https://i/150.jpg' }, { quality: '500x500', url: 'https://i/500.jpg' }], mood: 'sad', energy: 0.3 }));
    expect(f).toMatchObject({ id: 's1', title: 'Song s1', artist: 'Arijit', artistId: 'artist-arijit', album: 'Film', albumId: 'al', language: 'telugu', year: 2022, duration: 210, image: 'https://i/500.jpg', facets: { mood: 'sad', energy: 0.3 } });
  });

  it('a page with no usable shelf is no page', () => {
    expect(personalHomeOf({ shelves: [{ key: 'k', title: 't', songs: [{ id: 'nope' }] }] })).toBeNull();
    expect(personalHomeOf(null)).toBeNull();
  });
});
