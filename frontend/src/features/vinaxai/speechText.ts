/**
 * VinaX AI — a reply as something to say out loud. Read aloud speaks the
 * words, not the markup: code blocks, citation markers, link addresses,
 * tables' pipes and maths source are left out, and an artifact becomes one
 * short line naming it. The server splits the result into pieces the
 * speech model can take (POST /api/ai/speak).
 */
import { parseArtifacts } from './artifacts';

/** The most read aloud in one go; a longer reply is read up to here. */
export const MAX_SPEAK_CHARS = 6_000;

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'a link';
  }
};

function cleanMarkdown(md: string): string {
  let s = md.replace(/\r\n?/g, '\n');
  // Code blocks (fenced or ~~~) are not read; one short line says one was there.
  s = s.replace(/^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, '\n(There’s a code block here.)\n');
  // Display maths and inline maths source.
  s = s.replace(/\$\$[\s\S]*?\$\$/g, ' (an equation) ').replace(/\\\[[\s\S]*?\\\]/g, ' (an equation) ');
  s = s.replace(/(^|[^\\$\w])\$(?!\s)([^$\n]{1,200}?)\$(?!\w)/g, (_m, pre: string, body: string) => `${pre}${body.replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}^_]/g, ' ')}`);
  // Raw HTML tags (the renderer shows them as text; nobody wants them read).
  s = s.replace(/<\/?[a-zA-Z][^>\n]{0,200}>/g, ' ');
  // Images say their description; links say their words, bare links their site.
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt ? alt : ''));
  s = s.replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1');
  // (A sentence's full stop after a bare link stays a full stop.)
  s = s.replace(/<?(https?:\/\/[^\s<>)]+)>?/g, (_m, url: string) => {
    const tail = /[.,;:!?]+$/.exec(url)?.[0] ?? '';
    return hostOf(url.slice(0, url.length - tail.length)) + tail;
  });
  // Citation markers: [1], [2, 3], [1][2].
  s = s.replace(/\s?\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, '');
  // Tables: the divider row goes, cells are read as a list.
  s = s.replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '');
  s = s.replace(/^\s*\|(.*)\|\s*$/gm, (_m, row: string) => `${row.split('|').map((c) => c.trim()).filter(Boolean).join(', ')}.`);
  // Headings, quotes, list markers, rules.
  s = s.replace(/^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/gm, (_m, h: string) => (/[.!?:]$/.test(h) ? h : `${h}.`));
  s = s.replace(/^ {0,3}>\s?/gm, '');
  s = s.replace(/^ {0,3}(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/gm, '');
  s = s.replace(/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/gm, '');
  // Emphasis and inline code marks (the words stay).
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2').replace(/(\*|_)(?=\S)([^*_\n]*?\S)\1/g, '$2');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1').replace(/`([^`\n]+)`/g, '$1');
  // Tidy: no blank-line runs, no double spaces, no space before punctuation.
  return s.replace(/[ \t]+/g, ' ').replace(/ +([,.;:!?])/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
}

/** The words of a reply to read aloud (at most MAX_SPEAK_CHARS, cut at a sentence). */
export function speechText(reply: string): string {
  const parts = parseArtifacts(reply).map((seg) => (seg.kind === 'text'
    ? cleanMarkdown(seg.text)
    : `(${seg.artifact.title || 'An artifact'} is open in the side panel.)`));
  const all = parts.filter(Boolean).join('\n\n').trim();
  if (all.length <= MAX_SPEAK_CHARS) return all;
  const cut = all.slice(0, MAX_SPEAK_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
  return (end > MAX_SPEAK_CHARS / 2 ? cut.slice(0, end + 1) : cut).trim();
}

