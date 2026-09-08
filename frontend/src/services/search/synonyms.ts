/**
 * v5.15.0 — search synonyms published from the admin console
 * (Admin → Search Synonyms). A query that matches a key (whole query or a
 * whole word, case-insensitive) is rewritten before it reaches the catalogue,
 * so "arr" finds A. R. Rahman everywhere: Search, AI music commands, radio.
 */
let table: Record<string, string> = {};

export function setSearchSynonyms(map: Record<string, string> | undefined | null): void {
  table = map && typeof map === 'object' ? map : {};
}

export function rewriteQuery(q: string): string {
  const s = q.trim();
  if (!s || !Object.keys(table).length) return q;
  const whole = table[s.toLowerCase()];
  if (whole) return whole;
  return s
    .split(/\s+/)
    .map((w) => table[w.toLowerCase()] ?? w)
    .join(' ');
}
