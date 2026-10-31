/**
 * VinaX AI — [n] citation markers. A remark plugin turns `[n]` in a reply's
 * text into a citation element when source n exists; anything else (and
 * everything inside code) stays as written.
 */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const MARK = /\[(\d{1,2})\]/g;
const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference', 'math', 'inlineMath', 'html']);

/** Split one text into text and citation nodes for sources 1…count. */
export function splitCitations(value: string, count: number): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(MARK)) {
    const n = Number(m[1]);
    if (n < 1 || n > count) continue;
    const i = m.index ?? 0;
    if (i > last) out.push({ type: 'text', value: value.slice(last, i) });
    out.push({ type: 'citation', data: { hName: 'sup', hProperties: { dataCite: String(n) } }, children: [{ type: 'text', value: String(n) }] });
    last = i + m[0].length;
  }
  if (!out.length) return [{ type: 'text', value }];
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

export function remarkCitations(options: { count: number }) {
  const walk = (node: MdNode): void => {
    if (!node.children || SKIP.has(node.type)) return;
    node.children = node.children.flatMap((child) => (child.type === 'text' && child.value ? splitCitations(child.value, options.count) : (walk(child), [child])));
  };
  return (tree: MdNode) => {
    if (options.count > 0) walk(tree);
  };
}
