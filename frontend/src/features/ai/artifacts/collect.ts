import { tokenize } from '@/components/ai/tokenize';
import type { Msg } from '../chat/types';

/**
 * 9.1.0 — artifacts: the documents and code a conversation produced, collected
 * out of the replies so they can be opened, versioned and downloaded on their
 * own instead of being scrolled back to.
 *
 * It reuses the renderer's own fence parser (`components/ai/tokenize.ts`), so an
 * artifact is exactly what the chat already shows as a code block — there is no
 * second idea of what counts as code, and nothing is extracted that the listener
 * cannot already see.
 *
 * VERSIONS are the point. When a later reply contains a block that is plainly a
 * revision of an earlier one — same language, and either the same declared
 * filename or a recognisably similar body — the two become version 1 and version
 * 2 of ONE artifact rather than two unrelated blocks. "Make that shorter" three
 * times therefore gives one artifact with four versions, and every earlier
 * version is still there.
 *
 * Deliberately conservative: a one-line snippet is not an artifact, an unclosed
 * (still streaming) block is not an artifact, and when in doubt two blocks stay
 * separate. Over-grouping would hide a version behind an unrelated one, which is
 * worse than listing two things.
 */

/** Fewer lines than this is a snippet, not an artifact. */
export const MIN_ARTIFACT_LINES = 4;
/** …unless it is one of these, where even a short block is a thing in its own right. */
const ALWAYS_KINDS = new Set(['html', 'svg', 'mermaid', 'markdown', 'md']);

export type ArtifactKind = 'page' | 'diagram' | 'document' | 'code';

export interface ArtifactVersion {
  code: string;
  /** Index of the message it came from, so the panel can jump to it. */
  messageIndex: number;
  lines: number;
}

export interface Artifact {
  id: string;
  /** What to call it: a declared filename when the block had one, else a language label. */
  title: string;
  lang: string;
  kind: ArtifactKind;
  /** Oldest first. The last one is current. */
  versions: ArtifactVersion[];
}

export function kindOf(lang: string): ArtifactKind {
  if (lang === 'html') return 'page';
  if (lang === 'svg' || lang === 'mermaid') return 'diagram';
  if (lang === 'markdown' || lang === 'md') return 'document';
  return 'code';
}

/**
 * A filename the block itself declares, from the first few lines: a comment like
 * `// src/app.ts`, `# app.py`, `<!-- index.html -->`. Only a path-shaped token
 * with an extension counts, so a prose comment is never mistaken for a name.
 */
export function declaredName(code: string): string | null {
  for (const line of code.split('\n', 3)) {
    const m = /^\s*(?:\/\/|#|--|\/\*|<!--|;)\s*([\w./-]+\.[A-Za-z][\w]{0,9})\s*(?:\*\/|-->)?\s*$/.exec(line);
    if (m) {
      const name = m[1];
      // A bare version number or a URL fragment is not a filename.
      if (!/^\d/.test(name) && name.length <= 80) return name;
    }
  }
  return null;
}

/** First non-empty, non-comment line — the body's "shape" for the similarity check. */
function signature(code: string): string {
  for (const line of code.split('\n')) {
    const t = line.trim();
    if (!t || /^(\/\/|#|--|<!--|\/\*|;)/.test(t)) continue;
    return t.slice(0, 60).toLowerCase();
  }
  return '';
}

/** Share of the longer body's lines that the two have in common. 0..1. */
export function bodyOverlap(a: string, b: string): number {
  const lines = (s: string): Set<string> => new Set(s.split('\n').map((l) => l.trim()).filter((l) => l.length > 3));
  const A = lines(a);
  const B = lines(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const l of A) if (B.has(l)) shared += 1;
  return shared / Math.max(A.size, B.size);
}

/** Bodies this alike are taken to be two versions of one thing. */
export const REVISION_OVERLAP = 0.4;

/**
 * Collect the artifacts of a conversation, in the order they first appeared.
 * Only assistant replies are read: a block the LISTENER pasted is their own file,
 * not something the assistant produced.
 */
export function collectArtifacts(messages: readonly Msg[]): Artifact[] {
  const out: Artifact[] = [];
  messages.forEach((msg, messageIndex) => {
    if (msg.role !== 'assistant' || msg.failed || !msg.content) return;
    for (const token of tokenize(msg.content)) {
      if (token.t !== 'code' || !token.closed) continue;
      const code = token.code.trim();
      if (!code) continue;
      const lines = code.split('\n').length;
      const lang = token.lang || 'text';
      if (lines < MIN_ARTIFACT_LINES && !ALWAYS_KINDS.has(lang)) continue;
      const name = declaredName(code);
      const version: ArtifactVersion = { code, messageIndex, lines };
      // A revision of something already collected?
      const existing = out.find((a) => {
        if (a.lang !== lang) return false;
        const latest = a.versions[a.versions.length - 1];
        if (name && a.title === name) return true;
        // Same declared name is decisive; otherwise the bodies must look alike
        // AND open the same way, so two different files in one language stay apart.
        if (name && a.title !== name && declaredName(latest.code)) return false;
        return signature(latest.code) === signature(code) || bodyOverlap(latest.code, code) >= REVISION_OVERLAP;
      });
      if (existing) {
        // An identical re-print is not a new version.
        if (existing.versions[existing.versions.length - 1].code !== code) existing.versions.push(version);
        continue;
      }
      out.push({
        id: `a${out.length}-${lang}`,
        title: name ?? defaultTitle(lang, out.length),
        lang,
        kind: kindOf(lang),
        versions: [version],
      });
    }
  });
  return out;
}

const LANG_LABEL: Record<string, string> = {
  html: 'Page',
  svg: 'Drawing',
  mermaid: 'Diagram',
  markdown: 'Document',
  md: 'Document',
  json: 'Data',
  csv: 'Table',
  sql: 'Query',
  python: 'Python',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
};

function defaultTitle(lang: string, index: number): string {
  const label = LANG_LABEL[lang] ?? (lang === 'text' ? 'Snippet' : lang);
  return index === 0 ? label : `${label} ${index + 1}`;
}

/** The extension a download should use. */
export const EXTENSION: Record<string, string> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mmd',
  markdown: 'md',
  md: 'md',
  json: 'json',
  csv: 'csv',
  sql: 'sql',
  python: 'py',
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  css: 'css',
  yaml: 'yaml',
  yml: 'yml',
  sh: 'sh',
  bash: 'sh',
  text: 'txt',
};

export function fileNameFor(artifact: Artifact): string {
  if (/\.[A-Za-z]/.test(artifact.title)) return artifact.title;
  const ext = EXTENSION[artifact.lang] ?? 'txt';
  const stem = artifact.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'artifact';
  return `${stem}.${ext}`;
}

/** Can this artifact be previewed as a running page? */
export const isPreviewable = (artifact: Artifact): boolean => artifact.lang === 'html' || artifact.lang === 'svg';
