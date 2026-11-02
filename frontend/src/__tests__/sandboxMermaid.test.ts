/**
 * The artifact runner's diagram repair (sandbox/index.html, quoteLabels):
 * flowchart labels with brackets, slashes or other punctuation are put in
 * quotes, which the diagram language needs; everything else is unchanged.
 * The function is read out of the runner page itself, so this tests the code
 * that ships.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(resolve(__dirname, '../../../sandbox/index.html'), 'utf8');
const body = /\/\* quoteLabels:start \*\/([\s\S]*?)\/\* quoteLabels:end \*\//.exec(page)![1];
const quoteLabels = new Function(`${body}; return quoteLabels;`)() as (src: string) => string;

describe('the runner’s diagram label repair', () => {
  it('quotes the label from the owner’s screenshot, and others like it', () => {
    const src = 'flowchart TD\n  A[User interaction (text/voice)] --> B[App sends request]\n  B --> C{Search needed?}\n  C -->|Yes (web)| D(Search API / cache)\n  C -->|No| E((Model reply))';
    expect(quoteLabels(src)).toBe('flowchart TD\n  A["User interaction (text/voice)"] --> B[App sends request]\n  B --> C{Search needed?}\n  C -->|"Yes (web)"| D("Search API / cache")\n  C -->|No| E((Model reply))');
  });

  it('keeps nested brackets inside round labels, and already-quoted labels', () => {
    expect(quoteLabels('graph LR\n  A(Run (fast)) --> B["Done (ok)"]')).toBe('graph LR\n  A("Run (fast)") --> B["Done (ok)"]');
    expect(quoteLabels('graph LR\n  A[Say "hi" (x)] --> B')).toBe('graph LR\n  A["Say #quot;hi#quot; (x)"] --> B');
  });

  it('handles the other shapes and leaves styling lines alone', () => {
    const src = 'flowchart TB\n  subgraph Worker [Edge worker]\n  S[[Router: /api/ai]] --> D[(Database: v8)]\n  end\n  classDef hot fill:#f96\n  style S fill:#fff';
    expect(quoteLabels(src)).toBe('flowchart TB\n  subgraph Worker [Edge worker]\n  S[["Router: /api/ai"]] --> D[("Database: v8")]\n  end\n  classDef hot fill:#f96\n  style S fill:#fff');
  });

  it('never touches other diagram types', () => {
    const seq = 'sequenceDiagram\n  User->>App: Ask (voice)\n  App-->>User: Reply [1]';
    expect(quoteLabels(seq)).toBe(seq);
  });
});
