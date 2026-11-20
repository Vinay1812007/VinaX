import type { ArtistRef, Song } from '@/types';
import { albumPath, artistPath } from '@/utils/slug';
import { isEpisode, podcastPath } from '@/features/podcasts/paths';

/**
 * 1.20.1 — Credits the way Spotify lists them: one group per role (Singers,
 * Music, Lyrics, Starring, then anyone credited without a role), then the
 * film, the label and the year. A person is listed under every role they
 * have, once per role, and every name opens their page (or a search when the
 * catalogue gives no id).
 */
export interface CreditPerson {
  name: string;
  to: string;
}
export interface CreditGroup {
  role: string;
  people: CreditPerson[];
}
export interface SongCredits {
  groups: CreditGroup[];
  /** The film (or podcast) the song is from. */
  source: { role: 'Film' | 'Podcast'; name: string; to: string } | null;
  label: string | null;
  year: string | null;
  copyright: string | null;
}

const ROLES: ReadonlyArray<[string, RegExp]> = [
  ['Singers', /sing|vocal/],
  ['Music', /music|compos|producer/],
  ['Lyrics', /lyric|writ/],
  ['Starring', /starr|cast|actor/],
];

const linkFor = (a: ArtistRef): string => (a.id ? artistPath(a) : `/search/${encodeURIComponent(a.name)}`);

export function songCredits(song: Song, filmTitle: string | null = null): SongCredits {
  // The full role list when the catalogue sent one, else the lead artists.
  const people = song.credits?.length ? song.credits : song.artists;
  const groups: CreditGroup[] = [];
  const add = (role: string, a: ArtistRef): void => {
    const name = a.name.trim();
    if (!name) return;
    let g = groups.find((x) => x.role === role);
    if (!g) {
      g = { role, people: [] };
      groups.push(g);
    }
    if (!g.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) g.people.push({ name, to: linkFor(a) });
  };
  for (const [role, re] of ROLES) for (const a of people) if (re.test((a.role ?? '').toLowerCase())) add(role, a);
  // Anyone with no role we know still gets credited.
  for (const a of people) if (!ROLES.some(([, re]) => re.test((a.role ?? '').toLowerCase()))) add('Artists', a);
  // Keep the order of ROLES, then Artists.
  const order = [...ROLES.map(([r]) => r), 'Artists'];
  groups.sort((x, y) => order.indexOf(x.role) - order.indexOf(y.role));

  let source: SongCredits['source'] = null;
  if (song.album?.name) {
    if (isEpisode(song)) source = { role: 'Podcast', name: song.album.name, to: song.album.id ? podcastPath(song.album) : `/search/${encodeURIComponent(song.album.name)}` };
    else {
      const name = filmTitle ?? song.album.name;
      source = { role: 'Film', name, to: song.album.id ? albumPath(song.album) : `/search/${encodeURIComponent(name)}` };
    }
  }
  return { groups, source, label: song.label?.trim() || null, year: song.year || null, copyright: song.copyright?.trim() || null };
}
