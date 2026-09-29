import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { cosine } from './embeddings';
import { LOCAL_DIM, localSongVector, localTextVector } from './localVectors';

const song = (id: string, over: Partial<Song> = {}): Song =>
  ({ kind: 'song', id, title: id, subtitle: '', artists: [], album: null, images: [], audio: [], duration: null, language: null, year: null, explicit: false, hasLyrics: false, playCount: null, ...over }) as Song;

const norm = (v: Float32Array | null): number => (v ? Math.hypot(...v) : 0);

describe('on-device vectors', () => {
  it('are unit length, the fixed size, and deterministic', () => {
    const s = song('a', { language: 'telugu', mood: 'melancholy', year: '1998', artists: [{ id: '1', name: 'S. P. Balasubrahmanyam' }] });
    const v = localSongVector(s)!;
    expect(v).toHaveLength(LOCAL_DIM);
    expect(norm(v)).toBeCloseTo(1, 4);
    expect(Array.from(localSongVector({ ...s, id: 'a2' })!)).toEqual(Array.from(v));
    expect(norm(localTextVector('sad telugu songs'))).toBeCloseTo(1, 4);
  });

  it('put a sad Telugu song nearer "sad telugu songs" than a Hindi party song', () => {
    const q = localTextVector('sad telugu songs for rain');
    const sad = localSongVector(song('sad', { language: 'telugu', mood: 'melancholy' }));
    const party = localSongVector(song('party', { language: 'hindi', title: 'Party All Night', energy: 0.9 }));
    expect(cosine(q, sad)).toBeGreaterThan(cosine(q, party));
  });

  it('match an artist named in the text', () => {
    const q = localTextVector('sid sriram melodies');
    const sid = localSongVector(song('x', { artists: [{ id: '1', name: 'Sid Sriram' }] }));
    const other = localSongVector(song('y', { artists: [{ id: '2', name: 'Shreya Ghoshal' }] }));
    expect(cosine(q, sid)).toBeGreaterThan(cosine(q, other));
  });

  it('return null when there is nothing to hash', () => {
    expect(localTextVector('')).toBeNull();
    expect(localSongVector(song('bare'))).toBeNull();
  });
});
