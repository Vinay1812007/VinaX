/**
 * VinaX AI — artifacts in a reply: `<artifact id="…" type="…" title="…"
 * language="…">…</artifact>` (the contract in prompt.ts). The parser is
 * tolerant: attributes in any order and either quotes, an unknown type read
 * as code, a missing closing tag closing at the end (marked incomplete), and
 * nothing inside a code fence. Since 2026-11-16 a fenced ```html page,
 * ```svg or ```mermaid block (what the visuals prompt asks for) is an
 * artifact too, named by its <title> or front-matter title (splitFenced). The page has the same parser
 * (frontend/src/features/vinaxai/artifacts.ts) for showing them live.
 */

export type ArtifactType = 'code' | 'html' | 'svg' | 'mermaid' | 'markdown' | 'react';
export const ARTIFACT_TYPES: readonly ArtifactType[] = ['code', 'html', 'svg', 'mermaid', 'markdown', 'react'];

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  language: string | null;
  content: string;
  /** The reply ended before </artifact>. */
  incomplete: boolean;
}

export type Segment = { kind: 'text'; text: string } | { kind: 'artifact'; artifact: Artifact };

const OPEN = '<artifact';
const CLOSE = '</artifact>';

function attrs(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of header.matchAll(/([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
  return out;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Fence ranges ([start, end)) so a tag inside ``` code is left alone. */
function fences(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /^ {0,3}(```|~~~)/gm;
  let open = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (open < 0) open = m.index;
    else { out.push([open, m.index]); open = -1; }
  }
  if (open >= 0) out.push([open, text.length]);
  return out;
}

function parseTagged(text: string): Segment[] {
  const segs: Segment[] = [];
  const fenced = fences(text);
  const inFence = (i: number) => fenced.some(([a, b]) => i > a && i < b);
  let pos = 0;
  let n = 0;
  for (;;) {
    let at = text.indexOf(OPEN, pos);
    while (at >= 0 && (inFence(at) || !/[\s>]/.test(text[at + OPEN.length] ?? ' '))) at = text.indexOf(OPEN, at + 1);
    if (at < 0) break;
    const before = text.slice(pos, at);
    if (before.trim()) segs.push({ kind: 'text', text: before });
    const headerEnd = text.indexOf('>', at);
    n += 1;
    if (headerEnd < 0) {
      // The opening tag itself is still arriving.
      segs.push({ kind: 'artifact', artifact: { id: `artifact-${n}`, type: 'code', title: '', language: null, content: '', incomplete: true } });
      return segs;
    }
    const a = attrs(text.slice(at + OPEN.length, headerEnd));
    const type = (ARTIFACT_TYPES as readonly string[]).includes(a.type) ? (a.type as ArtifactType) : 'code';
    const title = a.title || '';
    const closeAt = text.indexOf(CLOSE, headerEnd + 1);
    let body = closeAt >= 0 ? text.slice(headerEnd + 1, closeAt) : text.slice(headerEnd + 1);
    if (closeAt < 0) {
      // Drop a closing tag that is only partly written.
      for (let k = CLOSE.length - 1; k > 0; k--) if (body.endsWith(CLOSE.slice(0, k))) { body = body.slice(0, -k); break; }
    }
    segs.push({
      kind: 'artifact',
      artifact: {
        id: slug(a.id || title) || `artifact-${n}`,
        type,
        title: title || (type === 'code' ? 'Code' : type.toUpperCase()),
        language: a.language || null,
        content: body.replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
        incomplete: closeAt < 0,
      },
    });
    if (closeAt < 0) return segs;
    pos = closeAt + CLOSE.length;
  }
  const rest = text.slice(pos);
  if (rest.trim() || !segs.length) segs.push({ kind: 'text', text: rest });
  return segs;
}


// ------------------------------------------------- fenced visual blocks

/** Code-fence languages that become artifacts (the visuals prompt asks for these). */
const VISUAL_LANGS: Record<string, ArtifactType> = { html: 'html', svg: 'svg', mermaid: 'mermaid' };
const DEFAULT_TITLE: Record<string, string> = { html: 'Page', svg: 'Illustration', mermaid: 'Diagram' };
/** A whole page, not a snippet in a lesson: these tags, or a long block. */
const PAGE_HINT = /<!doctype|<html[\s>]|<body[\s>]|<head[\s>]|<script[\s>]|<style[\s>]|<canvas[\s>]/i;
const PAGE_LINES = 15;

const decode = (s: string): string => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/** A visual's name: an html or svg <title>, or a Mermaid front-matter / `title` line. */
export function visualTitle(type: ArtifactType, content: string): string {
  if (type === 'mermaid') {
    const m = /^---\s*\n[\s\S]*?^\s*title:\s*["']?(.+?)["']?\s*$/m.exec(content) ?? /^\s*title\s+(.+?)\s*$/m.exec(content);
    return m ? decode(m[1]).slice(0, 80) : DEFAULT_TITLE.mermaid;
  }
  const m = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(content);
  return (m && decode(m[1]).slice(0, 80)) || DEFAULT_TITLE[type] || 'Artifact';
}

/** An html block that is a page (not a few lines of example markup); a block still arriving counts while it could be one. */
function isPage(content: string, incomplete: boolean): boolean {
  if (PAGE_HINT.test(content) || content.split('\n').length >= PAGE_LINES) return true;
  const head = content.trimStart().toLowerCase();
  return incomplete && '<!doctype html>'.startsWith(head.slice(0, 15));
}

/**
 * Fenced ```html (a whole page), ```svg and ```mermaid blocks in a stretch of
 * text, as artifacts between text segments; every other fence stays text. A
 * block still being written (no closing fence yet) is an incomplete artifact.
 */
function splitFenced(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\n`]*)$/gm;
  let pos = 0;
  let open: { mark: string; lang: string; at: number; body: number } | null = null;
  const push = (kind: ArtifactType, body: string, start: number, incomplete: boolean) => {
    const before = text.slice(pos, start);
    if (before.trim()) out.push({ kind: 'text', text: before });
    const content = body.replace(/\r?\n$/, '');
    const title = visualTitle(kind, content);
    out.push({ kind: 'artifact', artifact: { id: slug(title) || kind, type: kind, title, language: null, content, incomplete } });
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!open) {
      open = { mark: m[1], lang: (m[2].trim().split(/\s+/)[0] ?? '').toLowerCase(), at: m.index, body: m.index + m[0].length + 1 };
      continue;
    }
    // A closing fence: the same character, at least as long, nothing after it.
    if (m[1][0] !== open.mark[0] || m[1].length < open.mark.length || m[2].trim()) continue;
    const kind = VISUAL_LANGS[open.lang];
    const body = text.slice(Math.min(open.body, m.index), m.index);
    if (kind && (kind !== 'html' || isPage(body, false))) {
      push(kind, body, open.at, false);
      pos = m.index + m[0].length;
    }
    open = null;
  }
  if (open) {
    const kind = VISUAL_LANGS[open.lang];
    const body = text.slice(Math.min(open.body, text.length));
    if (kind && (kind !== 'html' || isPage(body, true))) {
      push(kind, body, open.at, true);
      return out;
    }
  }
  const rest = text.slice(pos);
  if (rest.trim() || !out.length) out.push({ kind: 'text', text: rest });
  return out;
}

/** The reply may hold artifacts: an <artifact> tag or a fenced html / svg / mermaid block. */
export const mayHaveArtifacts = (text: string): boolean => text.includes('<artifact') || /^ {0,3}(?:`{3,}|~{3,})[ \t]*(?:html|svg|mermaid)\b/im.test(text);

/**
 * A reply as text and artifacts: <artifact> tags first, then fenced visual
 * blocks in the text between them.
 */
export function parseArtifacts(text: string): Segment[] {
  const tagged = text.includes('<artifact') ? parseTagged(text) : [{ kind: 'text' as const, text }];
  const segs = tagged.flatMap((s) => (s.kind === 'text' ? splitFenced(s.text) : [s]));
  return segs.length ? segs : [{ kind: 'text', text }];
}

/** The artifacts of a reply, in order. */
export const artifactsOf = (text: string): Artifact[] =>
  parseArtifacts(text).flatMap((s) => (s.kind === 'artifact' ? [s.artifact] : []));
