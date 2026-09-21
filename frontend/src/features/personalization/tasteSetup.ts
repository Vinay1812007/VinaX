import type { ArtistRef, Song } from '@/types';
import { bumpArtist, bumpLanguage } from '@/services/personalization/profile';
import { withProfile } from '@/services/personalization/storage';
import { EVENT_WEIGHTS } from '@/services/personalization/eventWeights';

/**
 * 7.2 — the optional "pick languages & artists" step, for a listener who
 * would rather say what they like than wait for the app to learn it.
 *
 * A picked artist counts exactly as much as liking one of their songs
 * (`EVENT_WEIGHTS.FAVORITE`) on the same taste profile the rest of the app
 * writes to, through the same serialized read-modify-write. Nothing new is
 * stored and nothing leaves the device; the candidate sources that already
 * read "the listener's top artists" pick it up on the next queue.
 */
export interface PickedArtist extends ArtistRef {
  /** The language the artist was offered under, so the language learns too. */
  language?: string | null;
}

/** Distinct lead artists across a pool, in pool order, minus ones to leave out. */
export function leadArtists(songs: readonly Song[], exclude: (a: ArtistRef) => boolean = () => false): PickedArtist[] {
  const out: PickedArtist[] = [];
  const seen = new Set<string>();
  for (const s of songs) {
    const lead = s.artists?.[0];
    if (!lead || (!lead.id && !lead.name)) continue;
    const key = (lead.id || lead.name).toLowerCase();
    if (seen.has(key) || exclude(lead)) continue;
    seen.add(key);
    out.push({ ...lead, language: s.language });
  }
  return out;
}

/** Record the listener's own picks. Returns how many were counted. */
export function declareArtists(artists: readonly PickedArtist[]): number {
  const picks = artists.filter((a) => a.id || a.name);
  if (!picks.length) return 0;
  withProfile((p) => {
    for (const a of picks) {
      bumpArtist(p, a.id ?? '', a.name, EVENT_WEIGHTS.FAVORITE, 'signal');
      // Half as much for the language: the listener chose an artist, not a language.
      if (a.language) bumpLanguage(p, a.language, EVENT_WEIGHTS.FAVORITE / 2, 'signal');
    }
    return p;
  });
  return picks.length;
}
