/**
 * 9.1.0 — reading the text out of a PDF attachment, with no library.
 *
 * Why no library: a PDF engine is ~400 KB of JavaScript, and the attachment path
 * is already the heaviest thing in the chat. Browsers ship an inflater
 * (`DecompressionStream`), and a text-based PDF's content streams are zlib, so
 * the 150 lines below cover the case that actually matters — a document someone
 * wrote and exported — without the weight.
 *
 * **It is deliberately quick to admit defeat.** Extraction that returns garbage
 * is worse than extraction that returns nothing, because the garbage goes to a
 * model as if it were the document. So every answer here is one of:
 *
 *   ok          text we are confident in
 *   no-text     the file parsed but holds no text layer (a scan, or images only)
 *   unreadable  text came out, but it failed the quality check below — most
 *               often an embedded subset font with no usable encoding, where the
 *               bytes are glyph indices rather than characters
 *   encrypted   the document is encrypted; we do not attempt it
 *   too-large   past the byte cap
 *   failed      not a PDF, or malformed
 *
 * The caller shows the listener exactly which, so "I attached a PDF and it was
 * silently ignored" cannot happen.
 */

export type PdfTextOutcome = 'ok' | 'no-text' | 'unreadable' | 'encrypted' | 'too-large' | 'failed';

export interface PdfTextResult {
  outcome: PdfTextOutcome;
  text: string;
  /** Characters kept after the budget was applied. */
  chars: number;
  /** True when the text was cut to fit. */
  shortened: boolean;
  /** What to tell the listener. Always set for a non-`ok` outcome. */
  note: string;
}

/** Bytes we will read. A bigger PDF is almost always scans. */
export const MAX_PDF_BYTES = 8_000_000;
/** Characters of extracted text kept, before the attachment budget trims further. */
export const MAX_PDF_CHARS = 120_000;
/**
 * Share of extracted characters that must look like ordinary text. Below this we
 * call it unreadable rather than pass glyph soup to a model.
 */
export const MIN_READABLE_RATIO = 0.75;
/** Below this many characters there is nothing worth sending. */
const MIN_USEFUL_CHARS = 24;

const NOTE: Record<Exclude<PdfTextOutcome, 'ok'>, string> = {
  'no-text': 'no text layer — it looks like a scan or images only, so there is nothing to read. Export a text PDF, or paste the part you need.',
  unreadable: 'its text could not be decoded (usually an embedded font with no standard encoding). Copy the text across instead.',
  encrypted: 'it is encrypted, so its text cannot be read. Save an unprotected copy.',
  'too-large': `it is larger than the ${Math.round(MAX_PDF_BYTES / 1_000_000)} MB limit for PDFs.`,
  failed: 'it could not be read as a PDF.',
};

const fail = (outcome: Exclude<PdfTextOutcome, 'ok'>): PdfTextResult => ({ outcome, text: '', chars: 0, shortened: false, note: NOTE[outcome] });

/** Is this byte run a PDF at all? */
export const looksLikePdf = (bytes: Uint8Array): boolean =>
  bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF

/** Latin-1, so byte offsets in the parse match string offsets exactly. */
function latin1(bytes: Uint8Array): string {
  let out = '';
  // Chunked: String.fromCharCode(...huge) overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
}

/**
 * The file's bytes. `Blob.arrayBuffer()` is the obvious route and the one real
 * browsers take, but it is missing in some older Android WebViews, so
 * `FileReader` stands behind it. Null when neither works.
 *
 * `new Response(blob).arrayBuffer()` looks like a third option and is NOT used:
 * where the Response implementation does not recognise the Blob it stringifies
 * it, and you get the 13 bytes of "[object Blob]" instead of the file. Silent
 * corruption is worse than a clean failure, and the caller treats null honestly.
 */
export async function readBytes(file: Blob): Promise<Uint8Array | null> {
  try {
    if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  } catch {
    /* fall through */
  }
  try {
    if (typeof FileReader === 'function') {
      return await new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(new Error('unreadable'));
        reader.readAsArrayBuffer(file);
      });
    }
  } catch {
    /* nothing left to try */
  }
  return null;
}

async function inflate(bytes: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Every content stream in the file, decompressed where we can. Streams whose
 * filter we do not handle (LZW, JBIG2, DCT — i.e. images) are skipped, which is
 * why an image-only PDF ends up as `no-text` rather than as noise.
 */
async function contentStreams(raw: string, bytes: Uint8Array): Promise<string[]> {
  const out: string[] = [];
  const re = /stream\r?\n?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    // The dictionary immediately before the keyword says how it is encoded.
    const dict = raw.slice(Math.max(0, m.index - 400), m.index);
    if (/\/Image\b|\/DCTDecode\b|\/JPXDecode\b|\/JBIG2Decode\b|\/CCITTFaxDecode\b|\/LZWDecode\b/.test(dict)) {
      re.lastIndex = end;
      continue;
    }
    const slice = bytes.subarray(start, end);
    if (/\/FlateDecode\b/.test(dict)) {
      const plain = (await inflate(slice, 'deflate')) ?? (await inflate(slice, 'deflate-raw'));
      if (plain) out.push(latin1(plain));
    } else if (!/\/Filter\b/.test(dict)) {
      out.push(latin1(slice));
    }
    re.lastIndex = end;
    if (out.length > 2_000) break; // a pathological file is not worth more
  }
  return out;
}

/** Decode a PDF literal string's escapes. */
function literal(body: string): string {
  return body.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, esc: string) => {
    switch (esc) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case '(': return '(';
      case ')': return ')';
      case '\\': return '\\';
      default: return String.fromCharCode(parseInt(esc, 8));
    }
  });
}

const hexString = (body: string): string => {
  const clean = body.replace(/[^0-9a-fA-F]/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  return out;
};

/**
 * Pull the shown text out of one content stream: the `Tj`, `TJ`, `'` and `"`
 * operators. `Td`/`TD`/`T*`/`ET` become line breaks so paragraphs survive.
 */
export function textFromContentStream(content: string): string {
  let out = '';
  const re = /\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]*>|\bT[dD]\b|\bT\*|\bET\b|\bTj\b|\bTJ\b|\bBT\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const tok = m[0];
    if (tok.startsWith('(')) out += literal(tok.slice(1, -1));
    else if (tok.startsWith('<')) out += hexString(tok.slice(1, -1));
    else if (tok === 'Td' || tok === 'TD' || tok === 'T*' || tok === 'ET') out += '\n';
  }
  return out;
}

/**
 * Does this look like text a person wrote? Printable ASCII, common Unicode
 * letters and whitespace count; control bytes and lone glyph indices do not.
 * This is what keeps an unmapped subset font from reaching a model as content.
 */
export function readableRatio(text: string): number {
  if (!text.length) return 0;
  let good = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) good += 1;
    // \p{M} matters: an Indic vowel sign is a mark, and a script written with
    // them would otherwise score as unreadable and be thrown away.
    else if (c >= 0xa0 && !(c >= 0xd800 && c <= 0xdfff) && /[\p{L}\p{M}\p{N}\p{P}\p{Zs}\p{Sm}\p{Sc}]/u.test(ch)) good += 1;
  }
  return good / [...text].length;
}

/** Collapse the runs of whitespace an extraction always produces. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extract the text of a PDF. Never throws. */
export async function pdfToText(file: Blob): Promise<PdfTextResult> {
  if (file.size > MAX_PDF_BYTES) return fail('too-large');
  const bytes = await readBytes(file);
  if (!bytes || !looksLikePdf(bytes)) return fail('failed');
  const raw = latin1(bytes);
  // An /Encrypt entry in the trailer means the streams are enciphered.
  if (/\/Encrypt\b/.test(raw)) return fail('encrypted');
  let streams: string[];
  try {
    streams = await contentStreams(raw, bytes);
  } catch {
    return fail('failed');
  }
  if (!streams.length) return fail('no-text');
  let text = '';
  for (const content of streams) {
    text += textFromContentStream(content);
    if (text.length > MAX_PDF_CHARS * 2) break;
  }
  const tidied = tidy(text);
  if (tidied.length < MIN_USEFUL_CHARS) return fail('no-text');
  if (readableRatio(tidied) < MIN_READABLE_RATIO) return fail('unreadable');
  const shortened = tidied.length > MAX_PDF_CHARS;
  const kept = shortened ? tidied.slice(0, MAX_PDF_CHARS) : tidied;
  return {
    outcome: 'ok',
    text: kept,
    chars: kept.length,
    shortened,
    note: shortened ? 'only the first part of the PDF was read, to fit the message.' : '',
  };
}
