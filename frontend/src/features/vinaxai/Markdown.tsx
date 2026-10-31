/**
 * VinaX AI — renders a reply's Markdown (GFM: headings, lists, tables, task
 * lists, strikethrough, fenced code). Model output is untrusted:
 *   - raw HTML is never rendered; it is shown as text,
 *   - only http(s) and mailto links survive, opening in a new tab with
 *     rel="noopener noreferrer nofollow",
 *   - images are never loaded from arbitrary hosts; they show as links.
 * Maths ($inline$, $$display$$) renders with KaTeX, loaded the first time
 * a reply has a dollar sign (math.ts); prices stay prices (mathText.ts).
 * Citation chips arrive with web search (docs/ai.md).
 */
import { memo, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { escapeCurrency } from './mathText';

type Plugin = NonNullable<Options['remarkPlugins']>[number];
type MathPlugins = { remarkMath: Plugin; rehypeKatex: Plugin };
let mathPlugins: MathPlugins | null = null;
let mathLoading: Promise<MathPlugins | null> | null = null;
const loadMath = (): Promise<MathPlugins | null> => {
  mathLoading ??= import('./math')
    .then((m) => (mathPlugins = { remarkMath: m.remarkMath as Plugin, rehypeKatex: m.rehypeKatex as Plugin }))
    .catch(() => null);
  return mathLoading;
};

/** The maths plugins once a text needs them (null until then, or when they failed to load). */
function useMath(text: string): MathPlugins | null {
  const wanted = text.includes('$');
  const [plugins, setPlugins] = useState<MathPlugins | null>(mathPlugins);
  useEffect(() => {
    if (!wanted || plugins) return;
    let live = true;
    void loadMath().then((p) => { if (live && p) setPlugins(p); }).catch(() => undefined);
    return () => { live = false; };
  }, [wanted, plugins]);
  return wanted ? plugins : null;
}

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/** remark plugin: HTML in the Markdown becomes plain text. */
export function remarkHtmlAsText() {
  const walk = (node: MdNode, inFlow: boolean): void => {
    const kids = node.children;
    if (!kids) return;
    node.children = kids.map((child) => {
      if (child.type !== 'html') {
        walk(child, child.type === 'root' || child.type === 'blockquote' || child.type === 'listItem');
        return child;
      }
      const text: MdNode = { type: 'text', value: child.value ?? '' };
      return inFlow ? { type: 'paragraph', children: [text] } : text;
    });
  };
  return (tree: MdNode) => walk(tree, true);
}

/** Only web and mail links; everything else (javascript:, data:, relative paths) is dropped. */
export function safeUrl(url: string): string {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : '';
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}
const textOf = (n: HastNode | undefined): string => (!n ? '' : n.type === 'text' ? n.value ?? '' : (n.children ?? []).map(textOf).join(''));

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) => {
    const url = typeof src === 'string' ? src : '';
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="vx-ai-imglink">
        {alt || url}
      </a>
    ) : (
      <span>{alt}</span>
    );
  },
  pre: ({ node }) => {
    const code = (node as HastNode | undefined)?.children?.find((c) => c.tagName === 'code');
    const cls = code?.properties?.className;
    const lang = (Array.isArray(cls) ? cls.map(String) : []).find((c) => c.startsWith('language-'))?.slice(9) ?? '';
    return <CodeBlock code={textOf(code).replace(/\n$/, '')} lang={lang.toLowerCase()} />;
  },
  table: ({ children }) => (
    <div className="vx-ai-table" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
};

const remarkPlugins = [remarkGfm, remarkHtmlAsText];

export const Markdown = memo(function Markdown({ text }: { text: string }): ReactNode {
  const math = useMath(text);
  const remark: Options['remarkPlugins'] = math ? [remarkGfm, math.remarkMath, remarkHtmlAsText] : remarkPlugins;
  const rehype: Options['rehypePlugins'] = math ? [[math.rehypeKatex as never, { throwOnError: false, strict: 'ignore', trust: false, maxSize: 20, maxExpand: 200 }]] : undefined;
  return (
    <div className="vx-ai-md">
      <ReactMarkdown remarkPlugins={remark} rehypePlugins={rehype} components={components} urlTransform={safeUrl}>
        {math ? escapeCurrency(text) : text}
      </ReactMarkdown>
    </div>
  );
});
