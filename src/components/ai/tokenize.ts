/**
 * Splits assistant markdown into a flat token stream of prose and fenced-code
 * blocks. Kept pure (no React / KaTeX) so it is cheap to unit-test and safe to
 * run while a reply is still streaming — an unclosed fence yields a code token
 * with `closed: false` so the renderer can show it as plain text until it ends.
 */
export type Token =
  | { t: 'code'; lang: string; code: string; closed: boolean }
  | { t: 'prose'; text: string };

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const lines = src.split('\n');
  let i = 0;
  let prose: string[] = [];
  const flush = (): void => {
    if (prose.length) {
      tokens.push({ t: 'prose', text: prose.join('\n') });
      prose = [];
    }
  };
  while (i < lines.length) {
    const fence = /^```([\w+-]+)?\s*$/.exec(lines[i].trim());
    if (fence) {
      flush();
      const lang = (fence[1] || '').toLowerCase();
      const buf: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim().startsWith('```')) {
          closed = true;
          i += 1;
          break;
        }
        buf.push(lines[i]);
        i += 1;
      }
      tokens.push({ t: 'code', lang, code: buf.join('\n'), closed });
      continue;
    }
    prose.push(lines[i]);
    i += 1;
  }
  flush();
  return tokens;
}
