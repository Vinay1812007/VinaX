import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { songCredits } from './credits';

const base = {
  kind: 'song', id: 'zdIahOAI', title: 'Palle Kanneru Pedutundo', subtitle: 'Vandemataram Srinivas',
  artists: [{ id: '456809', name: 'Vandemataram Srinivas', role: 'primary_artists' }],
  album: { id: '1', name: 'Kubusam' }, images: [], audio: [{ quality: '320kbps', url: 'x' }], duration: 661,
  language: 'telugu', year: '2002', explicit: false, hasLyrics: false, playCount: null,
} as unknown as Song;

describe('songCredits', () => {
  it('lists each role from the full credits, a person under every role they have, then film, label and year', () => {
    const c = songCredits({
      ...base,
      credits: [
        { id: '456809', name: 'Vandemataram Srinivas', role: 'music' },
        { id: '456809', name: 'Vandemataram Srinivas', role: 'singer' },
        { id: '9', name: 'Goreti Venkanna', role: 'lyricist' },
        { id: '7', name: 'Sri Hari', role: 'starring' },
        { id: '8', name: 'Swapna', role: 'starring' },
      ],
      label: 'Aditya Music',
      copyright: '© 2018 Aditya Music',
    });
    expect(c.groups.map((g) => [g.role, g.people.map((p) => p.name)])).toEqual([
      ['Singers', ['Vandemataram Srinivas']],
      ['Music', ['Vandemataram Srinivas']],
      ['Lyrics', ['Goreti Venkanna']],
      ['Starring', ['Sri Hari', 'Swapna']],
    ]);
    expect(c.groups[0].people[0].to).toMatch(/^\/artist\/.+456809$/);
    expect(c.source).toMatchObject({ role: 'Film', name: 'Kubusam' });
    expect([c.label, c.year, c.copyright]).toEqual(['Aditya Music', '2002', '© 2018 Aditya Music']);
  });

  it('without full credits, the lead artists are credited as Artists (the 1.20 bug showed only Film)', () => {
    const c = songCredits(base);
    expect(c.groups).toEqual([{ role: 'Artists', people: [{ name: 'Vandemataram Srinivas', to: expect.stringMatching(/456809$/) }] }]);
  });

  it('a name without an id links to a search', () => {
    const c = songCredits({ ...base, credits: [{ id: '', name: 'Someone', role: 'lyricist' }] });
    expect(c.groups[0].people[0].to).toBe('/search/Someone');
  });
});
