/**
 * v5.19.0 — playlist tags. A collection carries up to eight short lower-case
 * labels ("chill", "long drive", "telugu 90s") that the Library can filter by.
 * Pure helpers; the library store owns the persisted field.
 */

export const TAG_MAX_PER_COLLECTION = 8;
export const TAG_MAX_LENGTH = 24;

/** One tag: lower-case, single-spaced, no leading '#', capped at TAG_MAX_LENGTH. */
export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[#\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TAG_MAX_LENGTH)
    .trim();
}

/**
 * Accepts a comma-separated string ("Chill, drive,, #Telugu") or an array and
 * returns the clean, de-duplicated list in input order, at most
 * TAG_MAX_PER_COLLECTION long. Non-string array items are ignored so a
 * malformed persisted value cannot throw.
 */
export function normalizeTags(input: string | string[]): string[] {
  const parts = Array.isArray(input) ? input : input.split(',');
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part !== 'string') continue;
    const tag = normalizeTag(part);
    if (!tag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= TAG_MAX_PER_COLLECTION) break;
  }
  return out;
}

/** Every tag in use across the given collections, alphabetical, unique. */
export function allTags(collections: ReadonlyArray<{ tags?: string[] }>): string[] {
  const set = new Set<string>();
  for (const c of collections) for (const t of c.tags ?? []) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Multi-select filter: with nothing selected everything passes; otherwise a
 * collection passes when it carries ANY of the selected tags.
 */
export function matchesTags(collection: { tags?: string[] }, selected: ReadonlyArray<string>): boolean {
  if (!selected.length) return true;
  const own = collection.tags ?? [];
  return selected.some((t) => own.includes(t));
}
