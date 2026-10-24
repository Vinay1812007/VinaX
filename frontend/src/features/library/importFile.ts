/**
 * 15.0 — turn an exported playlist file into the "Title — Artist" lines the
 * import sheet already understands, so a listener switching from another
 * service can drop in the file their old app gave them.
 *
 * Understood:
 * - CSV (a header row with title/track and artist columns, e.g. the exports
 *   most playlist tools write: "Track Name","Artist Name(s)", or
 *   "title","artist"); any other columns are ignored.
 * - M3U / M3U8: `#EXTINF:123,Artist - Title` lines (the path lines are skipped).
 * - Plain text: returned as is (one song per line).
 * Everything is parsed on the device; nothing is uploaded.
 */

export const IMPORT_ACCEPT = '.txt,.csv,.m3u,.m3u8,text/plain,text/csv,audio/x-mpegurl';

/** One CSV row, handling quoted fields with commas and doubled quotes. */
export function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (q) {
      if (c === '"' && row[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const TITLE_COLS = ['track name', 'track', 'title', 'song', 'name', 'song name'];
const ARTIST_COLS = ['artist name(s)', 'artist name', 'artists', 'artist', 'performer'];

function findCol(header: string[], wants: string[]): number {
  const h = header.map((s) => s.toLowerCase().replace(/^\uFEFF/, '').trim());
  for (const w of wants) {
    const i = h.indexOf(w);
    if (i >= 0) return i;
  }
  return -1;
}

export function csvToLines(text: string): string[] | null {
  const rows = text.split(/\r?\n/).filter((r) => r.trim());
  if (rows.length < 2) return null;
  const header = splitCsvRow(rows[0]);
  const ti = findCol(header, TITLE_COLS);
  if (ti < 0) return null;
  const ai = findCol(header, ARTIST_COLS);
  const out: string[] = [];
  for (const row of rows.slice(1)) {
    const cells = splitCsvRow(row);
    const title = (cells[ti] ?? '').trim();
    if (!title) continue;
    const artist = ai >= 0 ? (cells[ai] ?? '').split(/[;|]/)[0].trim() : '';
    out.push(artist ? `${title} — ${artist}` : title);
  }
  return out;
}

export function m3uToLines(text: string): string[] | null {
  if (!/^#EXTM3U/m.test(text) && !/^#EXTINF/m.test(text)) return null;
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^#EXTINF:\s*-?\d+(?:\.\d+)?[^,]*,(.+)$/.exec(raw.trim());
    if (!m) continue;
    const label = m[1].trim();
    // "Artist - Title" is the M3U convention; the sheet wants "Title — Artist".
    const split = /^(.{1,80}?)\s+-\s+(.{1,120})$/.exec(label);
    out.push(split ? `${split[2].trim()} — ${split[1].trim()}` : label);
  }
  return out.length ? out : null;
}

/** Lines for the import textarea, whatever the file was. */
export function fileToLines(name: string, text: string): string[] {
  const lower = name.toLowerCase();
  if (lower.endsWith('.m3u') || lower.endsWith('.m3u8')) return m3uToLines(text) ?? [];
  if (lower.endsWith('.csv')) return csvToLines(text) ?? text.split(/\r?\n/);
  return m3uToLines(text) ?? csvToLines(text) ?? text.split(/\r?\n/);
}
