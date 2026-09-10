/** Text helpers shared by the filesystem tools and the terminal renderer. */
import { createHash } from 'node:crypto';

/** Stable content hash quoted back by the model when it edits a file. */
export function contentHash(text: string | Buffer): string {
  return `sha256:${createHash('sha256').update(text).digest('hex').slice(0, 32)}`;
}

/**
 * Binary sniff.
 *
 * A NUL byte in the first few KB is the classic signal and catches every
 * common binary format. The high-byte ratio catches the rest — a compiled
 * artefact with no NUL in its header is still not something to hand a model
 * as "text".
 */
export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  if (n === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < n; i += 1) {
    const b = buf[i];
    if (b === 0) return true;
    // Control characters that are not tab, newline, carriage return or escape.
    if (b < 9 || (b > 13 && b < 32 && b !== 27)) suspicious += 1;
  }
  return suspicious / n > 0.3;
}

export type Newline = '\n' | '\r\n';

/** The dominant newline style of a file, so an edit can preserve it. */
export function detectNewline(text: string): Newline {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  return crlf > lf ? '\r\n' : '\n';
}

/** Rewrite every newline in `text` to `style`. */
export function withNewline(text: string, style: Newline): string {
  const lf = text.replace(/\r\n/g, '\n');
  return style === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
}

export interface Clipped {
  text: string;
  truncated: boolean;
  originalChars: number;
}

/**
 * Clip long output while keeping BOTH ends.
 *
 * The head says what ran; the tail says how it failed. A naive head-only clip
 * throws away the stack trace, which is the only part anybody wanted.
 */
export function clip(text: string, max: number): Clipped {
  if (text.length <= max) return { text, truncated: false, originalChars: text.length };
  const head = Math.floor(max * 0.4);
  const tail = max - head - 80;
  const omitted = text.length - head - tail;
  return {
    text: `${text.slice(0, head)}\n\n… ${omitted.toLocaleString('en-US')} characters omitted by VinaX …\n\n${text.slice(-tail)}`,
    truncated: true,
    originalChars: text.length,
  };
}

/** Wrap text to a width, preserving existing line breaks and indentation. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (line.length <= width) { out.push(line); continue; }
    const indent = (line.match(/^\s*/) ?? [''])[0];
    let cur = '';
    for (const word of line.trimStart().split(/\s+/)) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (indent.length + candidate.length > width && cur) {
        out.push(indent + cur);
        cur = word;
      } else {
        cur = candidate;
      }
    }
    out.push(indent + cur);
  }
  return out;
}

/** Count the lines of a text buffer without allocating the split array. */
export function countLines(text: string): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return text.endsWith('\n') ? n - 1 : n;
}
