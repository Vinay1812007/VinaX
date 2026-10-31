/**
 * VinaX AI — artifacts in a reply: `<artifact id="…" type="…" title="…"
 * language="…">…</artifact>` (the contract in prompt.ts). The parser is
 * tolerant: attributes in any order and either quotes, an unknown type read
 * as code, a missing closing tag closing at the end (marked incomplete), and
 * nothing inside a code fence. The server has the same parser
 * (backend/worker/functions/_lib/ai/artifacts.ts) and saves what it finds.
 */
import type { ChatMessage } from './types';

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

export function parseArtifacts(text: string): Segment[] {
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

/** The artifacts of a reply, in order. */
export const artifactsOf = (text: string): Artifact[] =>
  parseArtifacts(text).flatMap((s) => (s.kind === 'artifact' ? [s.artifact] : []));

// ------------------------------------------------------------- the page

/** Every artifact in the thread, by id, oldest version first (re-sending an id makes a new version). */
export function collectVersions(thread: readonly ChatMessage[]): Map<string, Array<{ messageId: string; artifact: Artifact }>> {
  const out = new Map<string, Array<{ messageId: string; artifact: Artifact }>>();
  for (const m of thread) {
    if (m.role !== 'assistant' || !m.text.includes('<artifact')) continue;
    for (const artifact of artifactsOf(m.text)) out.set(artifact.id, [...(out.get(artifact.id) ?? []), { messageId: m.id, artifact }]);
  }
  return out;
}

/** Previewed in the sandbox runner (markdown is shown by the chat's own renderer; code has no preview). */
export const runsInSandbox = (t: ArtifactType): boolean => t === 'html' || t === 'svg' || t === 'mermaid' || t === 'react';
export const hasPreview = (t: ArtifactType): boolean => runsInSandbox(t) || t === 'markdown';

const EXT: Record<string, string> = {
  python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx', java: 'java', kotlin: 'kt',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', cs: 'cs', go: 'go', rust: 'rs', ruby: 'rb', php: 'php', swift: 'swift', sql: 'sql',
  bash: 'sh', sh: 'sh', shell: 'sh', json: 'json', yaml: 'yml', yml: 'yml', css: 'css', html: 'html', xml: 'xml', dart: 'dart', r: 'r', lua: 'lua',
};

/** A file name and type for Download. */
export function downloadName(a: Pick<Artifact, 'type' | 'title' | 'language' | 'id'>): { name: string; mime: string } {
  const base = (a.title || a.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'artifact';
  switch (a.type) {
    case 'html': return { name: `${base}.html`, mime: 'text/html' };
    case 'svg': return { name: `${base}.svg`, mime: 'image/svg+xml' };
    case 'mermaid': return { name: `${base}.mmd`, mime: 'text/plain' };
    case 'markdown': return { name: `${base}.md`, mime: 'text/markdown' };
    case 'react': return { name: `${base}.jsx`, mime: 'text/javascript' };
    default: return { name: `${base}.${EXT[(a.language ?? '').toLowerCase()] ?? 'txt'}`, mime: 'text/plain' };
  }
}

/** The highlighter language for Code view. */
export const codeLanguage = (a: Pick<Artifact, 'type' | 'language'>): string =>
  a.type === 'react' ? 'javascript' : a.type === 'html' || a.type === 'svg' ? 'xml' : a.type === 'markdown' ? 'markdown' : a.type === 'mermaid' ? '' : (a.language ?? '').toLowerCase();
