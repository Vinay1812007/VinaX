/**
 * 2.0 — the `vinax-playlist` block VinaX AI writes (backend prompt, # Music):
 * an optional `title: …` line, then one song per line as "Title — Artist".
 * PlaylistCard.tsx shows it as a playable playlist. Pure.
 */
export interface PlaylistDraft {
  title: string;
  songs: Array<{ title: string; artist: string }>;
}

const MAX_SONGS = 50;
const SEPARATOR = /\s+(?:—|–|-|by)\s+/i;

/** Parse the block. Pure. Lines that are not "Title — Artist" are skipped. */
export function parsePlaylistBlock(text: string): PlaylistDraft {
  let title = '';
  const songs: PlaylistDraft['songs'] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (!line) continue;
    const named = /^title\s*:\s*(.+)$/i.exec(line);
    if (named) {
      if (!title) title = named[1].trim().slice(0, 80);
      continue;
    }
    const parts = line.split(SEPARATOR);
    if (parts.length < 2) continue;
    const songTitle = parts[0].replace(/^["“]|["”]$/g, '').trim();
    const artist = parts.slice(1).join(', ').trim();
    if (songTitle && artist && songs.length < MAX_SONGS) songs.push({ title: songTitle.slice(0, 120), artist: artist.slice(0, 120) });
  }
  return { title: title || 'Playlist from VinaX AI', songs };
}
