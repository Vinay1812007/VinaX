import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { tokenize } from './tokenize';

/**
 * Rich renderer for AI messages. Auto-detects and renders:
 * markdown (headings, tables, task lists, quotes, hr), fenced code with
 * copy + download, HTML/SVG live preview (sandboxed iframe), Mermaid diagrams,
 * CSV tables, and LaTeX math (inline + block). Streams safely — an unclosed
 * fence renders as plain preformatted text until it completes.
 */

// ---------- utilities ----------
const EXT: Record<string, string> = {
  javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx',
  python: 'py', py: 'py', html: 'html', css: 'css', json: 'json', csv: 'csv',
  sql: 'sql', yaml: 'yaml', yml: 'yml', xml: 'xml', markdown: 'md', md: 'md',
  svg: 'svg', bash: 'sh', sh: 'sh', shell: 'sh', java: 'java', c: 'c', cpp: 'cpp',
  'c++': 'cpp', go: 'go', rust: 'rs', php: 'php', ruby: 'rb', kotlin: 'kt', swift: 'swift',
};

function download(name: string, text: string, type = 'text/plain'): void {
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* download blocked */
  }
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }): ReactNode {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        try {
          void navigator.clipboard?.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          });
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="hover:text-ink-100 transition"
    >
      {done ? 'Copied' : label}
    </button>
  );
}

// ---------- LaTeX ----------
// KaTeX (~76 KB gz) loads on demand, only when a math token actually renders —
// most AI chats have no math, so the route stays light (DQA-15).
type KatexLib = typeof import('katex').default;
let katexLib: KatexLib | null = null;
let katexLoading: Promise<KatexLib | null> | null = null;

function loadKatex(): Promise<KatexLib | null> {
  if (!katexLoading) {
    katexLoading = Promise.all([import('katex'), import('katex/dist/katex.min.css')])
      .then(([m]) => {
        katexLib = m.default;
        return katexLib;
      })
      .catch(() => null);
  }
  return katexLoading;
}

function TeX({ tex, block }: { tex: string; block?: boolean }): ReactNode {
  const [lib, setLib] = useState<KatexLib | null>(katexLib);
  useEffect(() => {
    if (lib) return;
    let alive = true;
    void loadKatex().then((k) => {
      if (alive && k) setLib(() => k);
    });
    return () => {
      alive = false;
    };
  }, [lib]);
  const html = useMemo(() => {
    if (!lib) return null;
    try {
      return lib.renderToString(tex, { throwOnError: false, displayMode: !!block, output: 'html' });
    } catch {
      return null;
    }
  }, [lib, tex, block]);
  if (html == null) {
    // Engine still loading (or failed): show the raw TeX — never block the stream.
    return block ? (
      <div className="my-2 overflow-x-auto font-mono text-xs">{tex}</div>
    ) : (
      <span className="font-mono">{tex}</span>
    );
  }
  return block ? (
    <div className="my-2 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
}

// ---------- inline markdown ----------
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(`[^`]+`|\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\*\*[^*]+\*\*|\*[^*\n]+\*|~~[^~]+~~|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let last = 0;
  let key = 0;
  let m = re.exec(text);
  while (m !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`'))
      out.push(
        <code key={key} className="px-1 py-0.5 rounded bg-ink-800 text-[0.85em] font-mono">
          {tok.slice(1, -1)}
        </code>,
      );
    else if (tok.startsWith('$$')) out.push(<TeX key={key} tex={tok.slice(2, -2)} block />);
    else if (tok.startsWith('$')) out.push(<TeX key={key} tex={tok.slice(1, -1)} />);
    else if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('~~')) out.push(<del key={key} className="text-ink-400">{tok.slice(2, -2)}</del>);
    else if (tok.startsWith('*')) out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    else {
      const mm = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(tok);
      if (mm)
        out.push(
          <a key={key} href={mm[2]} target="_blank" rel="noopener noreferrer" className="text-ember-400 underline">
            {mm[1]}
          </a>,
        );
      else out.push(tok);
    }
    last = m.index + tok.length;
    key += 1;
    m = re.exec(text);
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const splitRow = (r: string): string[] =>
  r
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());

function TableBlock({ head, rows }: { head: string[]; rows: string[][] }): ReactNode {
  return (
    <div className="my-2 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-xs">
        <thead>
          <tr>
            {head.map((h, k) => (
              <th key={k} className="text-left px-3 py-2 bg-ink-800/70 border-b border-white/10 font-semibold whitespace-nowrap">
                {inline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="odd:bg-ink-900/40">
              {r.map((c, ci) => (
                <td key={ci} className="px-3 py-1.5 border-b border-white/5 align-top">
                  {inline(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const isTableSep = (s: string): boolean => /^\s*\|?[\s:|-]*-[-\s:|]*\|?\s*$/.test(s) && s.includes('-');

// ---------- block markdown ----------
function Prose({ text }: { text: string }): ReactNode {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '') {
      i += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      blocks.push(<hr key={blocks.length} className="my-3 border-white/10" />);
      i += 1;
      continue;
    }
    if (t === '$$') {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== '$$') {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(<TeX key={blocks.length} tex={buf.join('\n')} block />);
      continue;
    }
    const oneMath = /^\$\$(.+)\$\$$/.exec(t);
    if (oneMath) {
      blocks.push(<TeX key={blocks.length} tex={oneMath[1]} block />);
      i += 1;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl <= 1 ? 'text-xl' : lvl === 2 ? 'text-lg' : lvl === 3 ? 'text-base' : 'text-sm';
      blocks.push(
        <p key={blocks.length} className={cn('font-bold mt-2', cls)}>
          {inline(h[2])}
        </p>,
      );
      i += 1;
      continue;
    }
    if (/^>\s?/.test(t)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote key={blocks.length} className="my-2 pl-3 border-l-2 border-ember-500/50 text-ink-300">
          {inline(buf.join('\n'))}
        </blockquote>,
      );
      continue;
    }
    if (t.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(t);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i].trim()));
        i += 1;
      }
      blocks.push(<TableBlock key={blocks.length} head={head} rows={rows} />);
      continue;
    }
    if (/^[-*]\s+\[[ xX]\]\s+/.test(t)) {
      const items: { done: boolean; text: string }[] = [];
      while (i < lines.length && /^[-*]\s+\[[ xX]\]\s+/.test(lines[i].trim())) {
        const mm = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(lines[i].trim());
        if (mm) items.push({ done: mm[1].toLowerCase() === 'x', text: mm[2] });
        i += 1;
      }
      blocks.push(
        <ul key={blocks.length} className="my-1.5 space-y-1">
          {items.map((it, k) => (
            <li key={k} className="flex items-start gap-2">
              <span
                className={cn(
                  'mt-0.5 w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0',
                  it.done ? 'bg-ember-500 border-ember-500 text-black' : 'border-ink-500',
                )}
              >
                {it.done ? '✓' : ''}
              </span>
              <span className={it.done ? 'line-through text-ink-400' : ''}>{inline(it.text)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^[-*+]\s+/.test(t)) {
      const items: string[] = [];
      while (
        i < lines.length &&
        /^[-*+]\s+/.test(lines[i].trim()) &&
        !/^[-*]\s+\[[ xX]\]/.test(lines[i].trim())
      ) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={blocks.length} className="my-1.5 pl-5 list-disc space-y-1">
          {items.map((it, k) => (
            <li key={k}>{inline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={blocks.length} className="my-1.5 pl-5 list-decimal space-y-1">
          {items.map((it, k) => (
            <li key={k}>{inline(it)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const lt = lines[i].trim();
      if (
        lt === '' ||
        /^(#{1,6})\s+/.test(lt) ||
        /^[-*+]\s+/.test(lt) ||
        /^\d+\.\s+/.test(lt) ||
        /^>\s?/.test(lt) ||
        lt === '$$' ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(lt) ||
        (lt.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))
      )
        break;
      para.push(lines[i]);
      i += 1;
    }
    if (para.length)
      blocks.push(
        <p key={blocks.length} className="leading-relaxed whitespace-pre-wrap">
          {inline(para.join('\n'))}
        </p>,
      );
  }
  return <>{blocks}</>;
}

// ---------- code + previews ----------
// Tiny dependency-free syntax tinting: comments, strings, numbers and keywords
// get product-grade colour without shipping a highlighter library.
const KW = new Set(
  (
    'abstract and as async await break case catch class const continue def default del delete do elif else enum ' +
    'except export extends false final finally fn for from function go if impl implements import in instanceof ' +
    'interface is lambda let loop match mod new nil none not null of or package pass private protected public ' +
    'raise return select self static struct super switch this throw trait true try type typeof undefined use var ' +
    'void while with yield'
  ).split(' '),
);
const HASH_LANGS = new Set(['py', 'python', 'sh', 'bash', 'shell', 'rb', 'ruby', 'yaml', 'yml', 'toml', 'r']);

function highlightCode(code: string, lang: string): ReactNode[] {
  const out: ReactNode[] = [];
  const hash = HASH_LANGS.has(lang);
  const re = hash
    ? /(#[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d[\w.]*\b|\b[A-Za-z_]\w*\b)/g
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d[\w.]*\b|\b[A-Za-z_]\w*\b)/g;
  let last = 0;
  let key = 0;
  let m = re.exec(code);
  while (m !== null) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const tok = m[0];
    const c0 = tok[0];
    if ((hash && c0 === '#') || (!hash && (tok.startsWith('//') || tok.startsWith('/*'))))
      out.push(
        <span key={key} className="text-ink-400 italic">
          {tok}
        </span>,
      );
    else if (c0 === '"' || c0 === "'" || c0 === '`')
      out.push(
        <span key={key} className="text-emerald-600 dark:text-emerald-300">
          {tok}
        </span>,
      );
    else if (/\d/.test(c0))
      out.push(
        <span key={key} className="text-amber-600 dark:text-amber-300">
          {tok}
        </span>,
      );
    else if (KW.has(tok))
      out.push(
        <span key={key} className="text-ember-500 dark:text-ember-300 font-semibold">
          {tok}
        </span>,
      );
    else out.push(tok);
    last = m.index + tok.length;
    key += 1;
    m = re.exec(code);
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

function CodeBlock({ lang, code }: { lang: string; code: string }): ReactNode {
  const ext = EXT[lang] || 'txt';
  // Very large blocks skip tinting so the chat never jank-scrolls.
  const tinted = useMemo(() => (code.length > 20_000 ? code : highlightCode(code, lang)), [code, lang]);
  return (
    <div className="my-2 rounded-xl overflow-hidden border border-white/10 bg-ink-900">
      <div className="flex items-center justify-between px-3 py-1.5 bg-ink-800/70 text-[11px] text-ink-300">
        <span className="uppercase tracking-wide">{lang || 'text'}</span>
        <div className="flex items-center gap-3">
          <button onClick={() => download(`vinax.${ext}`, code)} className="hover:text-ink-100 transition">
            Download
          </button>
          <CopyBtn text={code} />
        </div>
      </div>
      <pre className="p-3 overflow-x-auto text-xs leading-relaxed font-mono">
        <code>{tinted}</code>
      </pre>
    </div>
  );
}

function MermaidBlock({ code }: { code: string }): ReactNode {
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
        const { svg: out } = await mermaid.render(`mmd${Math.random().toString(36).slice(2)}`, code);
        if (alive) setSvg(out);
      } catch {
        if (alive) setErr(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code]);
  if (err) return <CodeBlock lang="mermaid" code={code} />;
  if (!svg) return <div className="my-2 text-xs text-ink-400 py-3 px-1">Rendering diagram…</div>;
  return (
    <div className="my-2 rounded-xl border border-white/10 bg-ink-900 overflow-hidden">
      <div className="flex justify-end px-3 py-1.5 bg-ink-800/70 text-[11px] text-ink-300">
        <CopyBtn text={code} label="Copy source" />
      </div>
      <div className="overflow-x-auto p-3 grid place-items-center" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

function HtmlPreview({ lang, code }: { lang: string; code: string }): ReactNode {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const srcDoc =
    lang === 'svg'
      ? `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${code}</body>`
      : code;
  return (
    <div className="my-2 rounded-xl overflow-hidden border border-white/10 bg-ink-900">
      <div className="flex items-center justify-between px-3 py-1.5 bg-ink-800/70 text-[11px] text-ink-300">
        <div className="flex gap-3">
          <button onClick={() => setTab('preview')} className={cn('transition', tab === 'preview' ? 'text-ink-100 font-semibold' : 'hover:text-ink-100')}>
            Preview
          </button>
          <button onClick={() => setTab('code')} className={cn('transition', tab === 'code' ? 'text-ink-100 font-semibold' : 'hover:text-ink-100')}>
            Code
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => download(lang === 'svg' ? 'image.svg' : 'page.html', code, lang === 'svg' ? 'image/svg+xml' : 'text/html')}
            className="hover:text-ink-100 transition"
          >
            Download
          </button>
          <CopyBtn text={code} />
        </div>
      </div>
      {tab === 'preview' ? (
        <iframe title="preview" sandbox="allow-scripts" srcDoc={srcDoc} className="w-full h-80 bg-white" />
      ) : (
        <pre className="p-3 overflow-x-auto text-xs leading-relaxed font-mono">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

function CsvBlock({ code }: { code: string }): ReactNode {
  const rows = useMemo(() => code.trim().split(/\r?\n/).map((r) => r.split(',').map((c) => c.trim())), [code]);
  const head = rows[0] ?? [];
  const body = rows.slice(1);
  return (
    <div className="my-2 rounded-xl overflow-hidden border border-white/10">
      <div className="flex items-center justify-between px-3 py-1.5 bg-ink-800/70 text-[11px] text-ink-300">
        <span>CSV · {body.length} rows</span>
        <button onClick={() => download('data.csv', code, 'text/csv')} className="hover:text-ink-100 transition">
          Download .csv
        </button>
      </div>
      <div className="overflow-x-auto max-h-80">
        <table className="w-full text-xs">
          <thead>
            <tr>
              {head.map((h, k) => (
                <th key={k} className="text-left px-3 py-2 bg-ink-900 border-b border-white/10 font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri} className="odd:bg-ink-900/40">
                {r.map((c, ci) => (
                  <td key={ci} className="px-3 py-1.5 border-b border-white/5">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CodeRouter({ lang, code, closed }: { lang: string; code: string; closed: boolean }): ReactNode {
  if (!closed)
    return (
      <pre className="my-2 p-3 rounded-xl bg-ink-900 border border-white/10 overflow-x-auto text-xs leading-relaxed font-mono">
        <code>{code}</code>
      </pre>
    );
  if (lang === 'mermaid') return <MermaidBlock code={code} />;
  if (lang === 'html' || lang === 'svg' || lang === 'xml') return <HtmlPreview lang={lang} code={code} />;
  if (lang === 'csv') return <CsvBlock code={code} />;
  return <CodeBlock lang={lang} code={code} />;
}

// ---------- tokenizer + entry ----------
export function RichContent({ text }: { text: string }): ReactNode {
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <div className="space-y-1 text-sm break-words">
      {tokens.map((tk, i) =>
        tk.t === 'code' ? (
          <CodeRouter key={i} lang={tk.lang} code={tk.code} closed={tk.closed} />
        ) : (
          <Prose key={i} text={tk.text} />
        ),
      )}
    </div>
  );
}
