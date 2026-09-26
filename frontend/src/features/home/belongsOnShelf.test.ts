import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false, platformName: () => 'web', haptic: () => undefined }));

import type { Song } from '@/types';
import { belongsOnShelf } from './useAiHome';

const song = (over: Partial<Song>): Song => ({ kind: 'song', id: 'x', title: 't', subtitle: '', artists: [{ id: 'a', name: 'Sid Sriram' }], album: null, images: [], audio: [], duration: 200, language: 'telugu', year: null, explicit: false, hasLyrics: false, playCount: null, ...over }) as Song;

describe('belongsOnShelf (8.0.0)', () => {
  it('keeps only songs in the shelf language', () => {
    expect(belongsOnShelf(song({}), { language: 'telugu' })).toBe(true);
    expect(belongsOnShelf(song({ language: 'tamil' }), { language: 'telugu' })).toBe(false);
    expect(belongsOnShelf(song({ language: 'instrumental' }), { language: 'telugu' })).toBe(false);
    expect(belongsOnShelf(song({ language: null }), { language: 'telugu' })).toBe(false);
    expect(belongsOnShelf(song({ language: null }), {})).toBe(true);
  });
  it('keeps only songs crediting the singer on an artist shelf', () => {
    const shelf = { language: 'telugu', kind: 'artist', subject: 'Sid Sriram' };
    expect(belongsOnShelf(song({}), shelf)).toBe(true);
    expect(belongsOnShelf(song({ artists: [{ id: 'b', name: 'Armaan Malik' }] } as Partial<Song>), shelf)).toBe(false);
    expect(belongsOnShelf(song({ artists: [{ id: 'b', name: 'Armaan Malik' }], subtitle: 'Armaan Malik, Sid Sriram' } as Partial<Song>), shelf)).toBe(true);
    expect(belongsOnShelf(song({ artists: [{ id: 'b', name: 'Someone' }] } as Partial<Song>), { language: 'telugu', kind: 'composer', subject: 'Mani Sharma' })).toBe(true);
  });
});
