// @vitest-environment jsdom
/** Locks the client half of the playlist-variety fix (v3.3.1): the last ~60
 *  generated titles persist in localStorage and travel as avoidTitles[] on
 *  every request, successful generations feed the list (newest first, capped),
 *  and catalog resolution never collapses two suggestions onto the same
 *  search hit or the same catalog title. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));
vi.mock('@/services/ai/taste', () => ({ buildTasteSnapshot: () => ({}) }));
vi.mock('@/services/api', () => ({ searchSongs: vi.fn() }));
// 8.2.0 — the server embedding engine is out of these tests (the catalogue pool ranks on-device).
vi.mock('@/services/ai/embeddings', async (importActual) => {
  const actual = await importActual<typeof import('./embeddings')>();
  return { cosine: actual.cosine, activeEmbeddingModel: () => null, embedQueryDetailed: async () => null, embedSongs: async () => undefined, getCachedEmbedding: () => null };
});

import { failureReason, gatherCataloguePool, generatePlaylist, loadAvoidTitles, playlistErrorCopy, recordAvoidTitles, resolveSuggestions } from './playlist';
import { parseMusicIntent } from './musicIntent';
import { searchSongs } from '@/services/api';

const AVOID_KEY = 'vinax.aiplaylist.avoid.v1';

const song = (id: string, title: string): Song => ({ id, title, subtitle: 'A' }) as unknown as Song;

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(searchSongs).mockReset();
});

describe('avoid-title memory', () => {
  it('records newest first, dedupes case-insensitively and caps at 100', () => {
    // v3.7.1: cap bumped 60 → 100 so heavy users of AI Playlist don't exhaust
    // the anti-repeat memory in a couple of weeks.
    recordAvoidTitles(Array.from({ length: 95 }, (_, i) => `Old Song ${i}`));
    recordAvoidTitles(['Fresh One', 'FRESH ONE', 'Old Song 0', 'Fresh Two']);
    const list = loadAvoidTitles();
    expect(list).toHaveLength(97); // 95 + 2 new, dupes collapsed
    expect(list.slice(0, 3)).toEqual(['Fresh One', 'Old Song 0', 'Fresh Two']);
    recordAvoidTitles(Array.from({ length: 10 }, (_, i) => `Newer ${i}`));
    expect(loadAvoidTitles()).toHaveLength(100); // hard cap
    expect(loadAvoidTitles()[0]).toBe('Newer 0');
  });

  it('survives corrupt storage', () => {
    window.localStorage.setItem(AVOID_KEY, '{not json');
    expect(loadAvoidTitles()).toEqual([]);
  });
});

describe('generatePlaylist — avoid-list plumbing', () => {
  it('sends stored avoidTitles[] and records the new generation on success', async () => {
    recordAvoidTitles(['Previously Generated']);
    let sentBody: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
      sentBody = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: 'Mix',
          description: 'd',
          songs: [
            { title: 'Alpha', artist: 'X' },
            { title: 'Beta', artist: 'Y' },
          ],
        }),
      } as unknown as Response;
    });
    vi.mocked(searchSongs).mockImplementation(async (q: string) => [song(`id-${q}`, q)]);

    const res = await generatePlaylist('rainy vibes', [], []);
    vi.unstubAllGlobals();

    expect(res.ok).toBe(true);
    expect(sentBody.avoidTitles).toEqual(['Previously Generated']);
    // The new generation's titles now lead the memory for the NEXT request:
    // resolved catalog titles first (mock resolves "<title> <artist>" as the
    // catalog title), then the model's own titles, then (8.2.0) the catalogue
    // songs that filled the list, then the old memory.
    expect(loadAvoidTitles().slice(0, 6)).toEqual(['Alpha X', 'Beta Y', 'Alpha', 'Beta', 'melody songs', 'Previously Generated']);
  });
});

describe('resolveSuggestions — no convergence on one search hit', () => {
  it('excludes already-picked ids and titles during resolution', async () => {
    const shared = song('dup-1', 'Same Hit');
    vi.mocked(searchSongs)
      .mockResolvedValueOnce([shared]) // suggestion 1 → top hit
      .mockResolvedValueOnce([shared, song('alt-2', 'Different Song')]) // suggestion 2 → same top hit + alternative
      .mockResolvedValueOnce([song('dup-1b', 'Same Hit'), song('alt-3', 'Third Song')]); // same title, new id

    const out = await resolveSuggestions(
      [
        { title: 'Same Hit', artist: 'A' },
        { title: 'Same Hit Reprise', artist: 'A' },
        { title: 'Same Hit Again', artist: 'A' },
      ],
      25,
      [],
    );
    expect(out.map((s) => s.id)).toEqual(['dup-1', 'alt-2', 'alt-3']);
  });

  it('excludes recent generations even when the catalog has no fresh alternative', async () => {
    vi.mocked(searchSongs)
      // Popularity-ranked: the avoided canonical hit first, a fresh one second.
      .mockResolvedValueOnce([song('pop-1', 'Canonical Hit'), song('new-1', 'Fresh Cut')])
      // Everything avoided → still resolves (soft preference, not a filter).
      .mockResolvedValueOnce([song('pop-2', 'Canonical Hit Two')]);

    const out = await resolveSuggestions(
      [
        { title: 'Query One', artist: 'A' },
        { title: 'Query Two', artist: 'B' },
      ],
      25,
      [],
      ['Canonical Hit', 'Canonical Hit Two'],
    );
    expect(out.map((s) => s.id)).toEqual(['new-1']);
  });
});

describe('v7.0.0 — the catalogue song that IS the suggestion wins', () => {
  it('prefers the title + artist match over the first search hit, and clips untrusted strings', async () => {
    const credited = (id: string, title: string, artist: string) => ({ ...song(id, title), subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }] });
    vi.mocked(searchSongs).mockReset();
    vi.mocked(searchSongs).mockResolvedValue([]);
    vi.mocked(searchSongs).mockResolvedValueOnce([credited('dub', 'Kesariya (Telugu)', 'Someone Else'), credited('real', 'Kesariya', 'Arijit Singh')]);
    const out = await resolveSuggestions([{ title: '  Kesariya  ', artist: 'Arijit Singh' }, { title: 'x'.repeat(5000), artist: 'y'.repeat(5000) }], 25, []);
    expect(out[0].id).toBe('real');
    const longQuery = vi.mocked(searchSongs).mock.calls[1]?.[0] ?? '';
    expect(longQuery.length).toBeLessThanOrEqual(241);
  });

  it('never trusts the shape of the model answer', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ name: { evil: true }, description: 42, songs: [{ title: 'Gamma', artist: 'Z' }, { title: 7, artist: null }, null] }) }) as unknown as Response);
    vi.mocked(searchSongs).mockReset();
    vi.mocked(searchSongs).mockImplementation(async (q: string) => [song(`id-${q}`, q)]);
    const res = await generatePlaylist('evening drive', [], []);
    vi.unstubAllGlobals();
    expect(res).toMatchObject({ ok: true, playlist: { name: 'evening drive', description: '', source: 'ai' } });
    // The one valid suggestion leads; 8.2.0 — the catalogue pool fills in behind it.
    expect(res.ok && res.playlist.songs[0].id).toBe('id-Gamma Z');
  });

  it('stops resolving when the caller goes away', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    vi.mocked(searchSongs).mockReset();
    expect(await resolveSuggestions([{ title: 'Alpha', artist: 'X' }], 25, [], [], [], ctrl.signal)).toEqual([]);
    expect(searchSongs).not.toHaveBeenCalled();
  });
});

describe('8.2.0 — intent-aware playlists', () => {
  const lang = (id: string, language: string, title = id): Song => ({ ...song(id, title), language, artists: [] }) as unknown as Song;

  it('lets a language named in the prompt outrank the saved languages, and searches the catalogue in short phrasings', async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
      sent = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return { ok: true, status: 200, json: async () => ({ name: 'Lift', description: 'd', songs: [{ title: 'Pick', artist: 'A' }] }) } as unknown as Response;
    });
    vi.mocked(searchSongs).mockImplementation(async (q: string) =>
      q === 'Pick A' ? [lang('pick', 'telugu', 'Pick')] : Array.from({ length: 5 }, (_, i) => lang(`${q}-${i}`, i % 2 ? 'hindi' : 'telugu', `${q} ${i}`)),
    );
    const res = await generatePlaylist('Make me a Telugu workout playlist with high-energy songs.', ['hindi'], []);
    vi.unstubAllGlobals();
    expect(sent.languages).toEqual(['telugu']);
    const queries = vi.mocked(searchSongs).mock.calls.map((c) => c[0]);
    expect(queries).toContain('telugu dance songs');
    expect(queries).toContain('telugu mass songs');
    expect(queries.some((q) => /workout|high/.test(q))).toBe(false);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.playlist.songs[0].id).toBe('pick');
    expect(res.playlist.songs.length).toBeGreaterThan(1);
    expect(res.playlist.songs.every((s) => s.language === 'telugu')).toBe(true);
  });

  it('builds from the catalogue when the curator is over budget', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'ai_over_budget' }), { status: 503 }));
    // Fresh titles: the served-songs memory (module-level) remembers the previous test's.
    vi.mocked(searchSongs).mockImplementation(async (q: string) => Array.from({ length: 6 }, (_, i) => lang(`b-${q}-${i}`, 'telugu', `Budget ${q} ${i}`)));
    const res = await generatePlaylist('telugu workout songs', [], []);
    vi.unstubAllGlobals();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.playlist.source).toBe('catalogue');
    expect(res.playlist.name).toBe('Telugu Workout Mix');
    expect(res.playlist.songs.length).toBeGreaterThanOrEqual(8);
  });

  it('reports a temporary refusal as busy and a switch-off as disabled when the catalogue cannot help', async () => {
    vi.mocked(searchSongs).mockResolvedValue([]);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'ai_over_budget' }), { status: 503 }));
    expect(await generatePlaylist('telugu workout songs', [], [])).toEqual({ ok: false, reason: 'busy' });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'ai_disabled' }), { status: 503 }));
    expect(await generatePlaylist('telugu workout songs', [], [])).toEqual({ ok: false, reason: 'disabled' });
    vi.unstubAllGlobals();
  });

  it('maps failed answers to reasons', async () => {
    expect(await failureReason(new Response('{"error":"ai_disabled"}', { status: 503 }))).toBe('disabled');
    expect(await failureReason(new Response('{"error":"ai_not_configured"}', { status: 503 }))).toBe('not_configured');
    expect(await failureReason(new Response('{"error":"ai_over_budget"}', { status: 503 }))).toBe('busy');
    expect(await failureReason(new Response('', { status: 503 }))).toBe('busy');
    expect(await failureReason(new Response('', { status: 429 }))).toBe('busy');
    expect(await failureReason(new Response('', { status: 500 }))).toBe('error');
  });

  it('only says AI is off when it really is', () => {
    expect(playlistErrorCopy('disabled')).toMatch(/turned off/);
    expect(playlistErrorCopy('busy')).toMatch(/try again in a minute/);
    expect(playlistErrorCopy('busy')).not.toMatch(/not enabled|turned off/);
  });

  it('keeps the catalogue pool in the named language and out of the avoid list', async () => {
    vi.mocked(searchSongs).mockImplementation(async () => [lang('t1', 'telugu', 'Keep'), lang('h1', 'hindi', 'Other'), lang('t2', 'telugu', 'Avoided')]);
    const pool = await gatherCataloguePool(parseMusicIntent('telugu party'), ['telugu'], [], ['Avoided']);
    expect(pool.map((s) => s.id)).toEqual(['t1']);
  });
});
