/**
 * VinaX AI — a fenced code block: language label, Copy, Download (a file
 * named for its language), Wrap, line numbers for blocks of several lines
 * (hidden while wrapped, where they could not line up), and lazy
 * highlighting.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from '@/store/toastStore';
import { CopyIcon, DownloadIcon } from './icons';

type Highlighter = (code: string, lang: string) => string | null;
let highlighter: Highlighter | null = null;
let loading: Promise<Highlighter | null> | null = null;

function loadHighlighter(): Promise<Highlighter | null> {
  loading ??= import('./highlight')
    .then((m) => (highlighter = m.highlight))
    .catch(() => null);
  return loading;
}

export async function copyText(text: string, what = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(what);
  } catch {
    toast('Couldn’t copy');
  }
}

const EXTENSIONS: Record<string, string> = {
  javascript: 'js', js: 'js', mjs: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx', python: 'py', py: 'py', java: 'java',
  kotlin: 'kt', kt: 'kt', go: 'go', golang: 'go', rust: 'rs', rs: 'rs', ruby: 'rb', rb: 'rb', php: 'php', csharp: 'cs', cs: 'cs', 'c#': 'cs',
  cpp: 'cpp', 'c++': 'cpp', c: 'c', h: 'h', swift: 'swift', sql: 'sql', bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', powershell: 'ps1',
  html: 'html', css: 'css', scss: 'scss', json: 'json', yaml: 'yml', yml: 'yml', toml: 'toml', markdown: 'md', md: 'md', xml: 'xml',
  svg: 'svg', dart: 'dart', r: 'r', lua: 'lua', scala: 'scala', vue: 'vue', svelte: 'svelte', graphql: 'graphql', dockerfile: 'Dockerfile',
  mermaid: 'mmd', diff: 'diff', ini: 'ini', env: 'env',
};

/** The file name a block downloads as. */
export function fileNameFor(lang: string): string {
  const ext = EXTENSIONS[lang.trim().toLowerCase()] ?? 'txt';
  return ext === 'Dockerfile' ? ext : `snippet.${ext}`;
}

/** Blocks with at least this many lines get line numbers. */
export const NUMBER_FROM = 5;

export function downloadText(text: string, name: string): void {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  } catch {
    toast('Couldn’t download');
  }
}

export function CodeBlock({ code, lang }: { code: string; lang: string }): ReactNode {
  // Colours are worked out for one text; while that text keeps growing
  // (a reply being written) the plain, current text shows instead, so the
  // code on screen is never an older copy.
  const [lit, setLit] = useState<{ code: string; lang: string; html: string | null }>(() => ({ code, lang, html: highlighter?.(code, lang) ?? null }));
  const [wrap, setWrap] = useState(false);
  const lines = code.replace(/\n$/, '').split('\n').length;
  const numbered = !wrap && lines >= NUMBER_FROM;
  useEffect(() => {
    let live = true;
    // Wait for a pause in streaming before (re)highlighting.
    const t = setTimeout(() => {
      void loadHighlighter()
        .then((h) => { if (live) setLit({ code, lang, html: h ? h(code, lang) : null }); })
        .catch(() => undefined);
    }, highlighter ? 120 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [code, lang]);
  const html = lit.code === code && lit.lang === lang ? lit.html : null;
  return (
    <div className={`vx-ai-code${wrap ? ' is-wrapped' : ''}${numbered ? ' is-numbered' : ''}`}>
      <div className="vx-ai-code-bar">
        <span className="vx-ai-code-lang">{lang || 'text'}</span>
        <span className="vx-ai-code-tools">
          <button type="button" className="vx-ai-code-copy" onClick={() => setWrap((w) => !w)} aria-pressed={wrap} aria-label="Wrap long lines" title="Wrap long lines">
            <span>Wrap</span>
          </button>
          <button type="button" className="vx-ai-code-copy" onClick={() => downloadText(code, fileNameFor(lang))} aria-label={`Download ${fileNameFor(lang)}`} title="Download">
            <DownloadIcon className="w-4 h-4" />
          </button>
          <button type="button" className="vx-ai-code-copy" onClick={() => void copyText(code, 'Code copied')} aria-label="Copy code">
            <CopyIcon className="w-4 h-4" />
            <span>Copy</span>
          </button>
        </span>
      </div>
      <div className="vx-ai-code-body">
        {numbered && <span className="vx-ai-code-gutter" aria-hidden>{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</span>}
        <pre tabIndex={0}>
          {html != null ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}
        </pre>
      </div>
    </div>
  );
}
