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

/** Own, string-valued entries only: a bare `table[key]` also answers for
 *  inherited names ("constructor", "toString"), which turned those words into
 *  a function in the middle of a query. */
function lookup(key: string): string | undefined {
  // hasOwnProperty.call, not Object.hasOwn: the build targets ES2020 and older
  // Android WebViews do not ship the newer helper.
  if (!Object.prototype.hasOwnProperty.call(table, key)) return undefined;
  const value = table[key];
  return typeof value === 'string' && value ? value : undefined;
}

export function rewriteQuery(q: string): string {
  const s = q.trim();
  if (!s || !Object.keys(table).length) return q;
  const whole = lookup(s.toLowerCase());
  if (whole) return whole;
  return s
    .split(/\s+/)
    .map((w) => lookup(w.toLowerCase()) ?? w)
    .join(' ');
}
