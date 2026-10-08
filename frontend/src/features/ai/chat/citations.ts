/**
 * 11.2 — where a web-grounded reply's sources sit inside its text, and how a
 * source is named. Pure functions, no React.
 *
 * Placement: each support names the end of a segment of the reply (see
 * MsgSupport). The segment is found in the reply's raw markdown, the spot is
 * moved to the end of its sentence (or line, for a list item or heading), and
 * a citation mark (components/ai/cite) goes there; RichContent draws the mark
 * as a chip. Supports ending at the same spot share one chip. A spot inside a
 * code block, a table, inline code, maths or a link is skipped, and so is a segment
 * that is not in the text — the chips are an extra, never a reason to change
 * how the reply reads.
 */
import { citeMark } from '@/components/ai/cite';
import type { MsgSources, MsgSupport } from './types';

type Item = MsgSources['items'][number];

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
/** Second-level labels that are part of a country suffix (example.co.in). */
const SUFFIX_SECOND = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'gen', 'ind', 'nic', 'res']);

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** A site's name from its domain: the label before the suffix, capitalised
 *  ("news.example.co.in" -> "Example"). No guessing at word breaks. */
export function siteName(domain: string): string {
  const parts = domain.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length < 2) return domain;
  const cc = parts.length >= 3 && parts[parts.length - 1].length === 2 && SUFFIX_SECOND.has(parts[parts.length - 2]);
  const label = parts[parts.length - (cc ? 3 : 2)];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export interface SourceLabel {
  /** The publication, for the chip ("Example"). */
  name: string;
  /** The site ("example.com"); '' when unknown. */
  host: string;
  /** The page's own title, when the service gave one (not just the domain). */
  pageTitle: string;
  /** One letter for the monogram. */
  letter: string;
}

/** How a source is shown. The search service usually titles a page with its
 *  domain and links it through its own redirect, so the domain in the title
 *  is the honest name; a real page title is kept as the title. */
export function sourceLabel(it: Item): SourceLabel {
  const title = it.title.trim();
  const titleIsDomain = DOMAIN.test(title);
  const host = titleIsDomain ? title.toLowerCase().replace(/^www\./, '') : hostOf(it.url);
  const name = titleIsDomain ? siteName(title) : title || (host ? siteName(host) : 'Source');
  const letter = (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? '•').toUpperCase();
  return { name, host, pageTitle: titleIsDomain ? '' : title, letter };
}

/** [start, end) ranges of fenced code blocks (an unclosed fence runs to the end). */
function fenceRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let open = -1;
  let at = 0;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (open < 0) open = at;
      else {
        out.push([open, at + line.length]);
        open = -1;
      }
    }
    at += line.length + 1;
  }
  if (open >= 0) out.push([open, text.length]);
  return out;
}

/** True when a mark at `pos` would land inside inline code, maths or a link. */
function insideInline(line: string, col: number): boolean {
  const before = line.slice(0, col);
  if ((before.match(/`/g)?.length ?? 0) % 2 === 1) return true;
  if ((before.match(/(?<!\\)\$/g)?.length ?? 0) % 2 === 1) return true;
  for (const m of line.matchAll(/\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/\S+/g)) {
    const start = m.index ?? 0;
    if (col > start && col < start + m[0].length) return true;
  }
  return false;
}

/** Where the sentence holding `end` stops, on the same line. */
function sentenceEnd(text: string, end: number): number {
  const lineEnd = text.indexOf('\n', end) < 0 ? text.length : text.indexOf('\n', end);
  let p = end;
  const last = text.slice(0, end).replace(/[\s)*_"'”’]+$/, '').slice(-1);
  if (!/[.!?:;]/.test(last)) {
    const m = /[.!?](?=[\s)*_"'”’]|$)/.exec(text.slice(end, lineEnd));
    p = m ? end + (m.index ?? 0) + 1 : lineEnd;
  }
  // Past closing quotes, brackets and emphasis — when only space follows them.
  const tail = /^[)*_"'”’]{1,4}(?=\s|$)/.exec(text.slice(p, lineEnd));
  if (tail) p += tail[0].length;
  return p;
}

export interface PlacedCitations {
  /** The reply with citation marks in it. */
  text: string;
  /** Citation n -> its sources (indexes into the items). */
  cites: number[][];
}

/** Put one citation mark at the end of each supported sentence (see the module note). */
export function placeCitations(content: string, supports: MsgSupport[] | undefined, itemCount: number): PlacedCitations {
  if (!supports?.length || !itemCount || !content) return { text: content, cites: [] };
  const fences = fenceRanges(content);
  const at = new Map<number, number[]>();
  let cursor = 0;
  for (const sp of supports) {
    const seg = sp.text.trim();
    if (!seg) continue;
    let found = content.indexOf(seg, cursor);
    if (found < 0) found = content.indexOf(seg);
    if (found < 0) continue;
    cursor = found + seg.length;
    const pos = sentenceEnd(content, found + seg.length);
    if (fences.some(([a, b]) => pos >= a && pos <= b)) continue;
    const lineStart = content.lastIndexOf('\n', pos - 1) + 1;
    const lineEndRaw = content.indexOf('\n', pos);
    const line = content.slice(lineStart, lineEndRaw < 0 ? content.length : lineEndRaw);
    // A table row: a mark could become a cell of its own — leave tables alone.
    if (line.includes('|') || insideInline(line, pos - lineStart)) continue;
    const sources = sp.sources.filter((n) => Number.isInteger(n) && n >= 0 && n < itemCount);
    if (!sources.length) continue;
    const list = at.get(pos) ?? [];
    for (const n of sources) if (!list.includes(n)) list.push(n);
    at.set(pos, list);
  }
  if (!at.size) return { text: content, cites: [] };
  const spots = [...at.keys()].sort((a, b) => a - b);
  const cites: number[][] = [];
  let text = '';
  let from = 0;
  for (const pos of spots) {
    text += content.slice(from, pos) + citeMark(cites.length);
    cites.push(at.get(pos)!);
    from = pos;
  }
  return { text: text + content.slice(from), cites };
}
