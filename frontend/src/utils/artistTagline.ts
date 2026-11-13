/**
 * v2 — the catalogue's artist subtitle is often "Artist • 9487361 Listeners":
 * the kind (already the header's eyebrow) and a raw count (the meta line
 * shows it formatted). Keep only what is left, if anything.
 */
export function artistTagline(subtitle: string | null | undefined): string | null {
  const kept = (subtitle ?? '')
    .split(/\s*[•·|]\s*/)
    .map((p) => p.trim())
    .filter((p) => p && !/^artists?$/i.test(p) && !/\d[\d,.]*\s*[kmb]?\s*(listeners?|followers?|fans?|plays?)$/i.test(p));
  if (!kept.length) return null;
  const t = kept.join(' · ');
  return t[0].toUpperCase() + t.slice(1);
}
