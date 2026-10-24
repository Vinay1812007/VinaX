/**
 * 15.0 — text out of Office documents for VinaX AI attachments: Word
 * (.docx), Excel (.xlsx), PowerPoint (.pptx) and EPUB, read on the device.
 *
 * All four are zip files of XML; this pulls the right parts out and strips
 * the tags. The zip is read by hand (central directory → local headers) and
 * deflate is the browser's own `DecompressionStream('deflate-raw')`, so no
 * library is shipped. Formulas, images, layout and styling are not kept —
 * the model gets the words, in reading order, with cells separated by tabs
 * and slides by headings.
 */

export const OFFICE_EXTENSIONS = ['docx', 'xlsx', 'pptx', 'epub'] as const;
export type OfficeKind = (typeof OFFICE_EXTENSIONS)[number];

export function officeKind(name: string): OfficeKind | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return (OFFICE_EXTENSIONS as readonly string[]).includes(ext) ? (ext as OfficeKind) : null;
}

interface ZipEntry { name: string; method: number; compressed: number; size: number; offset: number }

function u16(v: DataView, o: number): number { return v.getUint16(o, true); }
function u32(v: DataView, o: number): number { return v.getUint32(o, true); }

/** The entries of a zip (from its central directory). */
export function listZip(buf: ArrayBuffer): ZipEntry[] {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // End of central directory: scan back for the signature.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70_000); i--) {
    if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count && p + 46 <= buf.byteLength; i++) {
    if (u32(v, p) !== 0x02014b50) break;
    const method = u16(v, p + 10);
    const compressed = u32(v, p + 20);
    const size = u32(v, p + 24);
    const nameLen = u16(v, p + 28);
    const extraLen = u16(v, p + 30);
    const commentLen = u16(v, p + 32);
    const offset = u32(v, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compressed, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The most one part may expand to: a text layer is never this big; a zip bomb always is. */
export const MAX_PART_BYTES = 8_000_000;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const reader = new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PART_BYTES) {
      await reader.cancel();
      throw new Error('part too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/** One entry's bytes (stored or deflated). */
export async function readZipEntry(buf: ArrayBuffer, e: ZipEntry): Promise<Uint8Array> {
  const v = new DataView(buf);
  const p = e.offset;
  if (u32(v, p) !== 0x04034b50) throw new Error('bad local header');
  const nameLen = u16(v, p + 26);
  const extraLen = u16(v, p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = new Uint8Array(buf, start, e.compressed);
  if (e.method === 0) {
    if (raw.length > MAX_PART_BYTES) throw new Error('part too large');
    return raw;
  }
  if (e.method === 8) return inflate(raw);
  throw new Error(`unsupported zip method ${e.method}`);
}

const decode = (b: Uint8Array): string => new TextDecoder('utf-8').decode(b);

/** Tags → text. Paragraph-like tags become line breaks; entities are decoded. */
export function xmlToText(xml: string, breakTags: RegExp): string {
  return xml
    .replace(breakTags, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ''; }).replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function docx(buf: ArrayBuffer, entries: ZipEntry[]): Promise<string> {
  const parts = entries.filter((e) => /^word\/(document|footnotes|endnotes)\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  let out = '';
  for (const e of parts) {
    const xml = decode(await readZipEntry(buf, e));
    out += xmlToText(xml.replace(/<w:tab\/>/g, '\t'), /<\/w:p>|<w:br\/>|<\/w:tr>/g) + '\n\n';
  }
  return out.trim();
}

async function xlsx(buf: ArrayBuffer, entries: ZipEntry[]): Promise<string> {
  const sst = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  const strings: string[] = [];
  if (sst) {
    const xml = decode(await readZipEntry(buf, sst));
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) strings.push(xmlToText(m[1], /$^/));
  }
  const sheets = entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort((a, b) => Number(/\d+/.exec(a.name)?.[0]) - Number(/\d+/.exec(b.name)?.[0]));
  let out = '';
  for (const e of sheets) {
    const xml = decode(await readZipEntry(buf, e));
    out += `## ${e.name.replace(/^xl\/worksheets\//, '').replace(/\.xml$/, '')}\n`;
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      // A cell is either self-closing (empty, styled) or open/close; matched
      // as one alternation so an empty cell never swallows its neighbour.
      for (const c of row[1].matchAll(/<c((?:[^>/]|\/(?!>))*)\/>|<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        if (c[1] !== undefined) { cells.push(''); continue; }
        const attrs = c[2];
        const inner = c[3];
        const t = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
        if (t === 's') cells.push(strings[Number(v)] ?? '');
        else if (t === 'inlineStr') cells.push(xmlToText(inner, /$^/));
        else cells.push(v);
      }
      if (cells.some((x) => x !== '')) out += cells.join('\t') + '\n';
    }
    out += '\n';
  }
  return out.trim();
}

async function pptx(buf: ArrayBuffer, entries: ZipEntry[]): Promise<string> {
  const slides = entries.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => Number(/\d+/.exec(a.name)?.[0]) - Number(/\d+/.exec(b.name)?.[0]));
  let out = '';
  for (const e of slides) {
    const xml = decode(await readZipEntry(buf, e));
    const n = /\d+/.exec(e.name)?.[0];
    out += `## Slide ${n}\n${xmlToText(xml, /<\/a:p>/g)}\n\n`;
  }
  const notes = entries.filter((e) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(e.name));
  for (const e of notes) {
    const text = xmlToText(decode(await readZipEntry(buf, e)), /<\/a:p>/g);
    if (text) out += `Notes ${/\d+/.exec(e.name)?.[0]}: ${text}\n`;
  }
  return out.trim();
}

async function epub(buf: ArrayBuffer, entries: ZipEntry[]): Promise<string> {
  const docs = entries.filter((e) => /\.(x?html|htm)$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let out = '';
  for (const e of docs.slice(0, 200)) {
    const html = decode(await readZipEntry(buf, e)).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
    out += xmlToText(html, /<\/(p|div|h[1-6]|li|tr|br)\s*\/?>|<br\s*\/?>/gi) + '\n\n';
  }
  return out.trim();
}

/** The document's text, or an outcome that says why there is none. */
export async function officeToText(file: File): Promise<{ outcome: 'ok'; text: string } | { outcome: 'empty' | 'unreadable'; note: string }> {
  const kind = officeKind(file.name);
  if (!kind) return { outcome: 'unreadable', note: 'not an Office document' };
  if (typeof DecompressionStream === 'undefined') return { outcome: 'unreadable', note: 'this browser cannot open Office files' };
  try {
    const buf = await file.arrayBuffer();
    const entries = listZip(buf);
    const text = kind === 'docx' ? await docx(buf, entries) : kind === 'xlsx' ? await xlsx(buf, entries) : kind === 'pptx' ? await pptx(buf, entries) : await epub(buf, entries);
    if (!text.trim()) return { outcome: 'empty', note: 'no text found in the document (pictures only?)' };
    return { outcome: 'ok', text };
  } catch {
    return { outcome: 'unreadable', note: 'the file could not be opened' };
  }
}
