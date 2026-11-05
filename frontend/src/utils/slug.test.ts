import { describe, expect, it } from 'vitest';
import { extractId, extractSongId, songPath } from './slug';

describe('extractSongId', () => {
  it('keeps an 8-character song id that contains a dash whole', () => {
    expect(extractSongId('teeje-week-H7SU6-O2')).toBe('H7SU6-O2');
    expect(extractSongId('nanage-neenu-from-upadhyaksha-o-I9e-Py')).toBe('o-I9e-Py');
    expect(extractSongId('x-abcdefg-')).toBe('abcdefg-');
    expect(extractSongId('H7SU6-O2')).toBe('H7SU6-O2');
    // extractId alone cuts it short — the bug this fixes
    expect(extractId('teeje-week-H7SU6-O2')).toBe('O2');
  });

  it('reads ordinary ids as before', () => {
    expect(extractSongId('mahi-from-deewana-MRYcngMQ')).toBe('MRYcngMQ');
    expect(extractSongId('MRYcngMQ')).toBe('MRYcngMQ');
    expect(extractSongId('x-123')).toBe('123');
    expect(extractSongId('qa1')).toBe('qa1');
    expect(extractSongId(undefined)).toBeUndefined();
  });

  it('round-trips songPath for dashed ids', () => {
    const path = songPath({ id: 'o-I9e-Py', title: 'Nanage Neenu' });
    expect(extractSongId(path.slice('/song/'.length))).toBe('o-I9e-Py');
  });
});
