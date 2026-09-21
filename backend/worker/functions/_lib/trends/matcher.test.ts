/**
 * Matching raw trend items to catalogue recordings. Pins the rules that keep
 * a chart entry from being mislabelled as a song: version tags must agree,
 * a transliteration needs another agreeing signal, ambiguity goes to review,
 * short-form reuse and non-songs never auto-match, and a catalogue outage
 * postpones instead of filing an item as unmatched.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_MATCH_THRESHOLD,
  crossScriptKey,
  latinKey,
  matchRawItem,
  parseSourceTitle,
  scoreCandidate,
  sourceCredits,
  titleEvidence,
  transliterate,
  type CatalogCandidate,
} from './matcher';
import type { RawTrendItem } from './types';

const song = (over: Partial<CatalogCandidate> & { id: string; title: string }): CatalogCandidate => ({
  primaryArtists: [],
  featuredArtists: [],
  credits: [],
  album: null,
  language: 'telugu',
  year: 2024,
  ...over,
});

const item = (title: string, over: Partial<RawTrendItem> = {}): RawTrendItem => ({
  source: 'youtube',
  sourceItemId: 'vid00000001',
  sourceUrl: 'https://www.youtube.com/watch?v=vid00000001',
  title,
  credit: 'Some Label',
  region: 'IN',
  sourceRank: 1,
  observedAt: '2026-09-19T06:00:00.000Z',
  languageEvidence: {},
  statistics: null,
  provenance: {},
  ...over,
});

const CHUTTAMALLE = song({ id: 'c1', title: 'Chuttamalle (From "Devara Part 1")', primaryArtists: ['Shilpa Rao'], credits: ['Anirudh Ravichander', 'Ramajogayya Sastry'], album: 'Devara Part 1 (Telugu)' });
const MONICA = song({ id: 'm1', title: 'Monica (From "Coolie")', primaryArtists: ['Sublahshini', 'Asal Kolaar'], credits: ['Anirudh Ravichander'], album: 'Coolie', language: 'tamil' });
const MONICA_REMIX = song({ id: 'm2', title: 'Monica (Remix)', primaryArtists: ['Sublahshini'], album: 'Monica (Remix)', language: 'tamil' });

function searchWith(results: CatalogCandidate[]) {
  return vi.fn(async () => results);
}

describe('parseSourceTitle', () => {
  it('reads the song, the film and the credits out of a pipe-separated video title', () => {
    const p = parseSourceTitle('Chuttamalle - Lyrical | Devara Part - 1 | NTR | Janhvi Kapoor | Anirudh | Shilpa Rao');
    expect(p.titles[0]).toBe('Chuttamalle');
    expect(p.segments).toContain('Devara Part');
    expect(p.segments).toContain('Shilpa Rao');
    expect(p.versionTag).toBe('');
    expect(p.notASong).toBe(false);
    expect(p.shortForm).toBe(false);
  });

  it('drops presentation words and reads a bracketed film credit', () => {
    const p = parseSourceTitle('Monica (From &quot;Coolie&quot;) - Full Video Song | Rajinikanth | Anirudh');
    expect(p.titles[0]).toBe('Monica');
    expect(p.movie).toBe('Coolie');
  });

  it('prefers a segment that calls itself a song over a leading film name', () => {
    const p = parseSourceTitle('Pushpa 2 The Rule | Peelings Song (Telugu) | Allu Arjun | Rashmika | DSP');
    expect(p.titles[0]).toBe('Peelings');
    expect(p.languageHint).toBe('telugu');
  });

  it('turns version words into the same version tag the catalogue identity uses', () => {
    expect(parseSourceTitle('Monica (Remix) | DJ Somebody').versionTag).toBe('remix');
    expect(parseSourceTitle('Kesariya - Lofi Version | Slowed + Reverb').versionTag).toBe('lofi+reverb+slowed');
    expect(parseSourceTitle('Tum Hi Ho | Live at the Arena').versionTag).toBe('live');
    // A film credit, a remaster or a year is the same recording.
    expect(parseSourceTitle('Tum Hi Ho (From "Aashiqui 2") (2013 Remastered)').versionTag).toBe('');
  });

  it('flags short-form reuse and non-song uploads', () => {
    expect(parseSourceTitle('Chuttamalle hook step #shorts').shortForm).toBe(true);
    expect(parseSourceTitle('original audio - somebody').shortForm).toBe(true);
    expect(parseSourceTitle('Devara Jukebox | All Songs').notASong).toBe(true);
    expect(parseSourceTitle('Coolie - Official Trailer | Rajinikanth').notASong).toBe(true);
  });

  it('splits featured credits into separate names', () => {
    const p = parseSourceTitle('Big Dawgs | Hanumankind ft. Kalmi');
    expect(sourceCredits(p, null)).toEqual(expect.arrayContaining(['Hanumankind', 'Kalmi']));
  });
});

describe('script handling', () => {
  it('romanises the Brahmic scripts letter by letter', () => {
    expect(transliterate('నాటు నాటు')).toBe('naatu naatu');
    expect(transliterate('सजनी')).toBe('sajanii');
    expect(transliterate('दिल')).toBe('dil'); // silent final vowel in the northern scripts
  });

  it('folds common romanisation variants to one key', () => {
    expect(latinKey('Naatu Naatu')).toBe(latinKey('Natu Natu'));
    expect(latinKey('Chuttamalle')).toBe(latinKey('Chuttamale'));
    expect(latinKey('Zindagi')).toBe(latinKey('Jindagi'));
  });

  it('compares across scripts only through the lossy cross-script key', () => {
    expect(crossScriptKey('సజనీ')).toBe(crossScriptKey('Sajni'));
    expect(crossScriptKey('सजनी')).toBe(crossScriptKey('Sajni'));
    expect(titleEvidence(['నాటు నాటు'], 'Naatu Naatu')).toEqual({ level: 'transliterated', crossScript: true });
    expect(titleEvidence(['Naatu Naatu'], 'Natu Natu')).toEqual({ level: 'phonetic', crossScript: false });
    expect(titleEvidence(['Naatu Naatu'], 'Naatu Naatu (From "RRR")')).toEqual({ level: 'exact', crossScript: false });
  });
});

describe('scoring', () => {
  it('an exact title with an agreeing singer and film is a confident match', () => {
    const p = parseSourceTitle('Chuttamalle - Lyrical | Devara Part - 1 | NTR | Janhvi Kapoor | Anirudh | Shilpa Rao');
    const s = scoreCandidate(p, sourceCredits(p, null), CHUTTAMALLE);
    expect(s.confidence).toBeGreaterThanOrEqual(0.95);
    expect(s.method).toBe('title:exact+artist+film');
  });

  it('a transliterated title alone stays below the threshold', () => {
    const p = parseSourceTitle('నాటు నాటు');
    const s = scoreCandidate(p, [], song({ id: 'n1', title: 'Naatu Naatu', primaryArtists: ['Rahul Sipligunj'], album: 'RRR' }));
    expect(s.confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(s.reason).toBe('transliteration');
  });
});

describe('matchRawItem', () => {
  it('matches a film song through its film credit and composer', async () => {
    const search = searchWith([MONICA, MONICA_REMIX]);
    const d = await matchRawItem(item('Monica - Video Song | Coolie | Rajinikanth | Anirudh Ravichander'), { search, budget: { remaining: 5 } });
    expect(d?.status).toBe('matched');
    expect(d?.catalogId).toBe('m1');
    expect(d?.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it('a remix trend maps to the remix recording, never to the original', async () => {
    const d = await matchRawItem(item('Monica (Remix) | Sublahshini'), { search: searchWith([MONICA, MONICA_REMIX]), budget: { remaining: 5 } });
    expect(d?.status).toBe('matched');
    expect(d?.catalogId).toBe('m2');
  });

  it('a remix trend with only the original in the catalogue goes to review as a version mismatch', async () => {
    const d = await matchRawItem(item('Monica (Remix) | Sublahshini'), { search: searchWith([MONICA]), budget: { remaining: 5 } });
    expect(d?.status).toBe('review');
    expect(d?.reason).toBe('version_mismatch');
  });

  it('the original trend with only a remix in the catalogue is not mapped to the remix', async () => {
    const d = await matchRawItem(item('Monica | Coolie | Sublahshini'), { search: searchWith([MONICA_REMIX]), budget: { remaining: 5 } });
    expect(d?.status).toBe('review');
    expect(d?.reason).toBe('version_mismatch');
  });

  it('a live cut is a different recording from the studio release', async () => {
    const studio = song({ id: 't1', title: 'Tum Hi Ho', primaryArtists: ['Arijit Singh'], album: 'Aashiqui 2', language: 'hindi' });
    const live = song({ id: 't2', title: 'Tum Hi Ho (Live)', primaryArtists: ['Arijit Singh'], album: 'Arijit Singh Live', language: 'hindi' });
    const d = await matchRawItem(item('Tum Hi Ho - Live | Arijit Singh'), { search: searchWith([studio, live]), budget: { remaining: 5 } });
    expect(d?.catalogId).toBe('t2');
    expect(d?.status).toBe('matched');
  });

  it('a native-script title with an agreeing singer reaches the threshold; alone it goes to review', async () => {
    const naatu = song({ id: 'n1', title: 'Naatu Naatu', primaryArtists: ['Rahul Sipligunj', 'Kaala Bhairava'], album: 'RRR' });
    const agreed = await matchRawItem(item('నాటు నాటు | Rahul Sipligunj'), { search: searchWith([naatu]), budget: { remaining: 5 } });
    expect(agreed?.status).toBe('matched');
    expect(agreed?.method).toBe('title:transliterated+artist');
    const alone = await matchRawItem(item('నాటు నాటు', { credit: null }), { search: searchWith([naatu]), budget: { remaining: 5 } });
    expect(alone?.status).toBe('review');
    expect(alone?.reason).toBe('transliteration');
  });

  it('two different songs with the same title and singer are ambiguous', async () => {
    const a = song({ id: 'a1', title: 'Ishq', primaryArtists: ['Singer One'], album: 'Film A', language: 'hindi', durationSec: 241 });
    const b = song({ id: 'b1', title: 'Ishq', primaryArtists: ['Singer One'], album: 'Film B', language: 'hindi', durationSec: 198 });
    const d = await matchRawItem(item('Ishq | Singer One'), { search: searchWith([a, b]), budget: { remaining: 5 } });
    expect(d?.status).toBe('review');
    expect(d?.reason).toBe('ambiguous');
    expect(d?.candidates.map((c) => c.id)).toEqual(expect.arrayContaining(['a1', 'b1']));
  });

  it('a compilation copy of the same recording is not an ambiguity', async () => {
    const film = song({ id: 'f1', title: 'Tum Hi Ho', primaryArtists: ['Arijit Singh'], album: 'Aashiqui 2', language: 'hindi', durationSec: 262 });
    const best = song({ id: 'f2', title: 'Tum Hi Ho', primaryArtists: ['Arijit Singh'], album: 'Best of Romance', language: 'hindi', durationSec: 262 });
    const d = await matchRawItem(item('Tum Hi Ho | Arijit Singh'), { search: searchWith([film, best]), budget: { remaining: 5 } });
    expect(d?.status).toBe('matched');
    expect(d?.catalogId).toBe('f1');
  });

  it('the film credit resolves what the title alone cannot', async () => {
    const a = song({ id: 'a1', title: 'Ishq', primaryArtists: ['Singer One'], album: 'Film A', language: 'hindi' });
    const b = song({ id: 'b1', title: 'Ishq', primaryArtists: ['Singer One'], album: 'Film B', language: 'hindi' });
    const d = await matchRawItem(item('Ishq (From "Film B") | Singer One'), { search: searchWith([a, b]), budget: { remaining: 5 } });
    expect(d?.status).toBe('matched');
    expect(d?.catalogId).toBe('b1');
  });

  it('a featured artist credited on the catalogue song counts as agreement', async () => {
    const dawgs = song({ id: 'd1', title: 'Big Dawgs', primaryArtists: ['Hanumankind'], featuredArtists: ['Kalmi'], language: 'english' });
    const d = await matchRawItem(item('Big Dawgs | Kalmi', { credit: null }), { search: searchWith([dawgs]), budget: { remaining: 5 } });
    expect(d?.status).toBe('matched');
  });

  it('a title that names a different language than the candidate is not matched', async () => {
    const d = await matchRawItem(item('Chuttamalle (Hindi) | Shilpa Rao'), { search: searchWith([CHUTTAMALLE]), budget: { remaining: 5 } });
    expect(d?.status).toBe('review');
    expect(d?.reason).toBe('language_mismatch');
  });

  it('short-form reuse of a song never auto-matches', async () => {
    const d = await matchRawItem(item('Chuttamalle hook step #shorts | Shilpa Rao'), { search: searchWith([CHUTTAMALLE]), budget: { remaining: 5 } });
    expect(d?.status).toBe('review');
    expect(d?.reason).toBe('short_form_reuse');
  });

  it('a compilation goes to review without spending a catalogue call', async () => {
    const search = searchWith([CHUTTAMALLE]);
    const d = await matchRawItem(item('Devara Jukebox | All Songs'), { search, budget: { remaining: 5 } });
    expect(d?.status).toBe('review');
    expect(d?.reason).toBe('not_a_song');
    expect(search).not.toHaveBeenCalled();
  });

  it('nothing in the catalogue → review as no candidate', async () => {
    const d = await matchRawItem(item('Completely Unknown Song | Nobody'), { search: searchWith([]), budget: { remaining: 5 } });
    expect(d?.status).toBe('review');
    expect(d?.reason).toBe('no_candidate');
    expect(d?.catalogId).toBeNull();
  });

  it('a catalogue outage postpones the decision instead of filing the item', async () => {
    const search = vi.fn(async () => {
      throw new Error('catalogue down');
    });
    expect(await matchRawItem(item('Chuttamalle | Shilpa Rao'), { search, budget: { remaining: 5 } })).toBeNull();
  });

  it('a spent budget postpones the decision', async () => {
    const search = searchWith([CHUTTAMALLE]);
    expect(await matchRawItem(item('Chuttamalle | Shilpa Rao'), { search, budget: { remaining: 0 } })).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it('spends at most two catalogue calls per item and draws them from the shared budget', async () => {
    const search = searchWith([]);
    const budget = { remaining: 5 };
    await matchRawItem(item('Unknown | Film X | Singer Y'), { search, budget });
    expect(search.mock.calls.length).toBeLessThanOrEqual(2);
    expect(budget.remaining).toBe(5 - search.mock.calls.length);
  });

  describe('editorial entries that name a catalogue id', () => {
    const editorial = (title: string, catalogIdHint: string) => item(title, { source: 'editorial', sourceItemId: 'ed-1', credit: 'Shilpa Rao', artistHint: 'Shilpa Rao', catalogIdHint });

    it('are matched with full confidence after the id is confirmed', async () => {
      const lookup = vi.fn(async () => CHUTTAMALLE);
      const d = await matchRawItem(editorial('Chuttamalle', 'c1'), { search: searchWith([]), lookup, budget: { remaining: 5 } });
      expect(d).toMatchObject({ status: 'matched', catalogId: 'c1', confidence: 1, method: 'editorial-catalog-id' });
    });

    it('go to review when the id is unknown or names a different song', async () => {
      const unknown = await matchRawItem(editorial('Chuttamalle', 'zz'), { search: searchWith([]), lookup: vi.fn(async () => null), budget: { remaining: 5 } });
      expect(unknown).toMatchObject({ status: 'review', reason: 'catalog_id_not_found' });
      const other = await matchRawItem(editorial('Chuttamalle', 'm1'), { search: searchWith([]), lookup: vi.fn(async () => MONICA), budget: { remaining: 5 } });
      expect(other).toMatchObject({ status: 'review', reason: 'catalog_id_title_mismatch' });
    });
  });
});
