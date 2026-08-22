import type { Song } from '@/types';

/** Non-music catalog noise: film dialogues, BGM cuts, jukebox strips,
 *  commentary and ringtones. These sneak into search-backed shelves and
 *  ruin mixes (a "Daily Mix" of movie dialogues is not a mix). Explicit
 *  search result tabs deliberately do NOT use this filter. */
const JUNK = /\b(dialogues?|bgm|jukebox|commentary|ringtone|promo|teaser|trailer|lyric video|lyrical video|video song|full video|official video)\b/i;

export function isJunkTrack(song: Song): boolean {
  const albumName = (song.album as { name?: string | null } | null | undefined)?.name ?? '';
  return JUNK.test(`${song.title} ${albumName}`);
}

export function musicalOnly(songs: Song[]): Song[] {
  return songs.filter((s) => !isJunkTrack(s));
}

/** Shelf diversity: cap songs sharing one album/cover so a row never shows
 *  six identical tiles. Order-preserving — keeps the best-ranked two. */
export function diversify(songs: Song[], maxPerAlbum = 2): Song[] {
  const seen = new Map<string, number>();
  const seenTitles = new Set<string>();
  const out: Song[] = [];
  for (const s of songs) {
    // The same song reissued across albums/mixes must not fill a shelf.
    const normTitle = s.title
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (normTitle && seenTitles.has(normTitle)) continue;
    const albumName = ((s.album as { name?: string | null } | null | undefined)?.name ?? '').toLowerCase();
    const art = s.images?.[0]?.url ?? '';
    const key = albumName || art || normTitle;
    const n = seen.get(key) ?? 0;
    if (n >= maxPerAlbum) continue;
    seen.set(key, n + 1);
    if (normTitle) seenTitles.add(normTitle);
    out.push(s);
  }
  return out;
}
