/** VinaX AI — a fenced code block: language label, Copy, and lazy highlighting. */
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from '@/store/toastStore';
import { CopyIcon } from './icons';

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

export function CodeBlock({ code, lang }: { code: string; lang: string }): ReactNode {
  const [html, setHtml] = useState<string | null>(() => highlighter?.(code, lang) ?? null);
  useEffect(() => {
    let live = true;
    // Wait for a pause in streaming before (re)highlighting.
    const t = setTimeout(() => {
      void loadHighlighter()
        .then((h) => { if (live) setHtml(h ? h(code, lang) : null); })
        .catch(() => undefined);
    }, highlighter ? 120 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [code, lang]);
  return (
    <div className="vx-ai-code">
      <div className="vx-ai-code-bar">
        <span className="vx-ai-code-lang">{lang || 'text'}</span>
        <button type="button" className="vx-ai-code-copy" onClick={() => void copyText(code, 'Code copied')} aria-label="Copy code">
          <CopyIcon className="w-4 h-4" />
          <span>Copy</span>
        </button>
      </div>
      <pre tabIndex={0}>
        {html != null ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}
      </pre>
    </div>
  );
}
