/** Clean, crawlable detail-page URL helpers (e.g. /song/<slug>-<id>). */
export function slugify(text: string | undefined): string {
  return (
    String(text ?? '')
      .toLowerCase()
      .normalize('NFKD')
      // HTML entities from the catalog (&quot; &amp; …) must never become
      // slug words ('-quot-') — strip entity patterns before the collapse.
      .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'x'
  );
}

/** Extract the real id from a "<slug>-<id>" param. Bare ids pass through. */
export function extractId(param: string | undefined): string | undefined {
  if (!param) return param;
  const parts = param.split('-');
  return parts[parts.length - 1] || param;
}

/**
 * The song id from a "/song/<slug>-<id>" param. Catalogue song ids are 8
 * characters and may contain "-" (H7SU6-O2), which extractId would cut to
 * "O2". The slug is always lowercase, so when the last piece is shorter than
 * an id, the id is the last 8 characters (keep in sync with songIdOf in
 * backend/worker/functions/_lib/render.ts and scripts/prerender-entities.mjs).
 */
export function extractSongId(param: string | undefined): string | undefined {
  if (!param) return param;
  const last = param.split('-').pop() ?? '';
  if (last.length >= 8 || param.length < 8) return last || param;
  return param.length === 8 || param[param.length - 9] === '-' ? param.slice(-8) : last || param;
}

export function songPath(song: { id: string; title?: string }): string {
  // 1.4 — a generated song has no catalogue page: it opens in the player.
  if (song.id.startsWith('gen-')) return '/now-playing';
  return `/song/${song.title ? `${slugify(song.title)}-` : ''}${song.id}`;
}
export function albumPath(a: { id: string; title?: string; name?: string }): string {
  const n = a.title ?? a.name;
  return `/album/${n ? `${slugify(n)}-` : ''}${a.id}`;
}
export function artistPath(a: { id: string; name?: string }): string {
  return `/artist/${a.name ? `${slugify(a.name)}-` : ''}${a.id}`;
}

export function playlistPath(p: { id: string; title?: string }): string {
  return `/playlist/${p.title ? `${slugify(p.title)}-` : ''}${p.id}`;
}
