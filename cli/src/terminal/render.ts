/**
 * Terminal rendering.
 *
 * The brief is "polished, but reliability over decoration". So: no full-screen
 * redraws, no alternate screen buffer, no frame loop. Output is written
 * forward, line by line, which means a resize cannot corrupt it, a piped
 * stdout gets clean text, and scrollback stays readable an hour later.
 *
 * Colour is switched off whenever anything suggests it is unwanted —
 * NO_COLOR, TERM=dumb, CI, or a stdout that is not a terminal — because a
 * pipeline full of escape sequences is worse than plain text.
 */

export interface Theme {
  color: boolean;
  width: number;
  /** Terminals that cannot render box drawing get ASCII instead. */
  unicode: boolean;
}

export function detectTheme(opts: { color?: boolean | null; stream?: NodeJS.WriteStream } = {}): Theme {
  const stream = opts.stream ?? process.stdout;
  const env = process.env;
  const explicitlyOff = env.NO_COLOR !== undefined || env.TERM === 'dumb';
  const isTty = Boolean(stream.isTTY);
  const color = opts.color ?? (!explicitlyOff && isTty && env.CI === undefined);
  const width = Math.max(40, Math.min(stream.columns ?? 80, 120));
  const unicode =
    env.TERM !== 'dumb' &&
    (process.platform !== 'win32' || env.WT_SESSION !== undefined || env.TERM_PROGRAM !== undefined);
  return { color, width, unicode };
}

const ESC = '\u001b';
const CODES = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  grey: `${ESC}[90m`,
} as const;

export type ColorName = keyof typeof CODES;

export function paint(theme: Theme, name: ColorName, text: string): string {
  if (!theme.color) return text;
  return `${CODES[name]}${text}${CODES.reset}`;
}

export interface Glyphs {
  step: string;
  ok: string;
  fail: string;
  ask: string;
  warn: string;
  bullet: string;
  todo: string;
  doing: string;
  vbar: string;
  corner: string;
  end: string;
  rule: string;
}

/** Marks used down the left of the transcript. */
export function glyphs(theme: Theme): Glyphs {
  return theme.unicode
    ? { step: '●', ok: '✓', fail: '✗', ask: '◆', warn: '!', bullet: '•', todo: '○', doing: '●', vbar: '│', corner: '┌─', end: '└─', rule: '─' }
    : { step: '*', ok: 'v', fail: 'x', ask: '?', warn: '!', bullet: '-', todo: 'o', doing: '*', vbar: '|', corner: '+-', end: '+-', rule: '-' };
}

/**
 * Render a subset of Markdown for a terminal.
 *
 * Headings, bold, inline code, fenced blocks and rules — the shapes a coding
 * answer actually uses. Anything else passes through as written, because
 * mangling unfamiliar syntax is worse than leaving it alone.
 */
export function renderMarkdown(text: string, theme: Theme): string {
  const g = glyphs(theme);
  const out: string[] = [];
  let inFence = false;
  for (const raw of text.split('\n')) {
    const fence = /^\s*```(.*)$/.exec(raw);
    if (fence) {
      if (!inFence) {
        inFence = true;
        out.push(paint(theme, 'grey', `  ${g.corner} ${fence[1].trim() || 'code'}`));
      } else {
        inFence = false;
        out.push(paint(theme, 'grey', `  ${g.end}`));
      }
      continue;
    }
    if (inFence) {
      out.push(paint(theme, 'cyan', `  ${g.vbar} ${raw}`));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      out.push(paint(theme, 'bold', heading[2]));
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(raw)) {
      out.push(paint(theme, 'grey', g.rule.repeat(Math.min(theme.width, 60))));
      continue;
    }
    out.push(inline(raw, theme));
  }
  return out.join('\n');
}

function inline(line: string, theme: Theme): string {
  if (!theme.color) return line;
  return line
    .replace(/`([^`]+)`/g, (_m, code: string) => paint(theme, 'cyan', code))
    .replace(/\*\*([^*]+)\*\*/g, (_m, b: string) => paint(theme, 'bold', b));
}

/** Colour a unified diff. */
export function renderDiff(diff: string, theme: Theme): string {
  return diff
    .split('\n')
    .map((l) => {
      if (l.startsWith('@@')) return paint(theme, 'grey', `  ${l}`);
      if (l.startsWith('+')) return paint(theme, 'green', `  ${l}`);
      if (l.startsWith('-')) return paint(theme, 'red', `  ${l}`);
      return paint(theme, 'grey', `  ${l}`);
    })
    .join('\n');
}

/** The header shown when an interactive session opens. */
export function sessionHeader(
  theme: Theme,
  info: { project: string; branch: string; engine: string; approval: string; web: boolean; apiBase: string; showApiBase: boolean },
): string {
  const g = glyphs(theme);
  const rows: Array<[string, string]> = [['Project', info.project]];
  if (info.branch) rows.push(['Branch', info.branch]);
  rows.push(['Engine', info.engine], ['Access', info.approval], ['Web', info.web ? 'On' : 'Off']);
  if (info.showApiBase) rows.push(['Service', info.apiBase]);
  const width = Math.max(...rows.map((r) => r[0].length));
  return [
    paint(theme, 'bold', 'VinaX CLI'),
    '',
    ...rows.map(([k, v]) => `${paint(theme, 'grey', k.padEnd(width))}  ${v}`),
    '',
    paint(theme, 'grey', `${g.bullet} /help for commands, Ctrl+C to interrupt, /exit to leave`),
    '',
  ].join('\n');
}

/** Prefix every line of a block. */
export function indent(text: string, prefix: string): string {
  return text.split('\n').map((l) => `${prefix}${l}`).join('\n');
}
