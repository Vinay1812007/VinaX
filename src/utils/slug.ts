/** Clean, crawlable detail-page URL helpers (e.g. /song/<slug>-<id>). */
export function slugify(text: string | undefined): string {
  return (
    String(text ?? '')
      .toLowerCase()
      .normalize('NFKD')
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

export function songPath(song: { id: string; title?: string }): string {
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
