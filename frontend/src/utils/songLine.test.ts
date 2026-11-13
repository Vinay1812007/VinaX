import { describe, expect, it } from 'vitest';
import { formatSongLine, songLine } from './songLine';
import { makeSong } from '@/__fixtures__/songs';

describe('formatSongLine', () => {
  it('reads Song – Movie/Album – Artist', () => {
    expect(formatSongLine(makeSong('1', { title: 'Samajavaragamana', artist: 'Sid Sriram', album: { id: 'a', name: 'Ala Vaikunthapurramuloo' } as never }))).toBe('Samajavaragamana – Ala Vaikunthapurramuloo – Sid Sriram');
  });

  it('drops a "(From …)" tag that would repeat the album, and tidies soundtrack suffixes', () => {
    const s = makeSong('2', { title: 'Sasirekha (From "Mana Shankara Varaprasad Garu")', artist: 'Bheems Ceciroleo', album: { id: 'a', name: 'Mana Shankara Varaprasad Garu (Original Motion Picture Soundtrack)' } as never });
    expect(songLine(s)).toEqual({ title: 'Sasirekha', album: 'Mana Shankara Varaprasad Garu', artist: 'Bheems Ceciroleo' });
  });

  it('uses the film from the title when the "album" is just the single itself, and copes with no album at all', () => {
    const single = makeSong('3', { title: 'Monica (From "Coolie")', artist: 'Anirudh', album: { id: 'a', name: 'Monica' } as never });
    expect(formatSongLine(single)).toBe('Monica – Coolie – Anirudh');
    expect(formatSongLine(makeSong('4', { title: 'Loose Track', artist: 'Someone' }))).toBe('Loose Track – Someone');
  });

  it('credits at most two artists and keeps non-Latin titles intact', () => {
    const s = { ...makeSong('5', { title: 'నువ్వే నువ్వే', album: { id: 'a', name: 'నువ్వే కావాలి' } as never }), artists: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }, { id: '3', name: 'C' }] };
    expect(formatSongLine(s)).toBe('నువ్వే నువ్వే – నువ్వే కావాలి – A, B');
  });

  it('takes the film from an album that carries the tag, and never repeats the album as the artist', () => {
    const tagged = { ...makeSong('6', { title: 'Mangal Rang (From "Ramayana")', album: { id: 'a', name: 'Mangal Rang (From "Ramayana")' } as never }), artists: [{ id: '1', name: 'A.R. Rahman' }] };
    expect(songLine(tagged)).toEqual({ title: 'Mangal Rang', album: 'Ramayana', artist: 'A.R. Rahman' });
    const bare = { ...makeSong('7', { title: 'Tu Mil Jaaye (From "KING")', album: { id: 'a', name: 'Tu Mil Jaaye (From "KING")' } as never }), artists: [], subtitle: 'Tu Mil Jaaye (From "KING")' };
    expect(songLine(bare)).toEqual({ title: 'Tu Mil Jaaye', album: 'KING', artist: '' });
    const dashed = { ...makeSong('8', { title: 'Jai Jai Ram', album: { id: 'a', name: 'Ramayana' } as never }), artists: [], subtitle: 'A.R. Rahman, Shreya Ghoshal - Jai Jai Ram (From "Ramayana")' };
    expect(songLine(dashed).artist).toBe('A.R. Rahman, Shreya Ghoshal');
  });
});
