// @vitest-environment jsdom
/** Lyrics tools on the device: line answers must keep the count, and Romanized asks the AI only for lyrics still in their own script. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';

vi.mock('@/services/auth/google', () => ({ currentAccount: () => ({ session: 'session-token' }) }));

import { aiLyricLines, aiLyricsMeaning, mostlyNonLatin } from './lyricsAi';
import { resetMusicAi } from './musicAi';

const song = makeSong('l1', { title: 'Nee Kallu', artist: 'Anurag Kulkarni', language: 'telugu' });
const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

beforeEach(() => resetMusicAi());

describe('lyrics tools', () => {
  it('returns translated lines one for one, and refuses a mismatched count', async () => {
    const fetcher = ok({ lines: ['Your eyes', '', 'My life'] });
    expect(await aiLyricLines('translate', ['నీ కళ్ళు', '', 'నా ప్రాణం'], song, { fetcher })).toEqual(['Your eyes', '', 'My life']);
    const body = JSON.parse(String(((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body).toMatchObject({ mode: 'translate', title: 'Nee Kallu', artist: 'Anurag Kulkarni', language: 'telugu' });
    expect(await aiLyricLines('translate', ['a', 'b'], song, { fetcher: ok({ lines: ['only one'] }) })).toBeNull();
  });

  it('explains the meaning, or says nothing on failure', async () => {
    expect(await aiLyricsMeaning(['line'], song, { fetcher: ok({ meaning: 'A song about longing.', mood: 'wistful' }) })).toEqual({ meaning: 'A song about longing.', mood: 'wistful' });
    expect(await aiLyricsMeaning(['line'], song, { fetcher: ok({}) })).toBeNull();
  });

  it('knows when lyrics are still in their own script', () => {
    expect(mostlyNonLatin(['నీ కళ్ళు', 'నా ప్రాణం'])).toBe(true);
    expect(mostlyNonLatin(['Nee kallu', 'naa praanam'])).toBe(false);
    expect(mostlyNonLatin([''])).toBe(false);
  });
});
