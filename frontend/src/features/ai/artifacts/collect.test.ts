import { describe, expect, it } from 'vitest';
import type { Msg } from '../chat/types';
import { bodyOverlap, collectArtifacts, declaredName, fileNameFor, isPreviewable, kindOf, MIN_ARTIFACT_LINES } from './collect';

const reply = (content: string): Msg => ({ role: 'assistant', content });
const asked = (content: string): Msg => ({ role: 'user', content });
const block = (lang: string, body: string): string => `Here you go:\n\n\`\`\`${lang}\n${body}\n\`\`\`\n`;
const lines = (n: number, tag = 'x'): string => Array.from({ length: n }, (_, i) => `const ${tag}${i} = ${i};`).join('\n');

describe('declaredName', () => {
  it('reads a filename the block declares', () => {
    expect(declaredName('// src/app.ts\nconst a = 1;')).toBe('src/app.ts');
    expect(declaredName('# app.py\nprint(1)')).toBe('app.py');
    expect(declaredName('<!-- index.html -->\n<p>hi</p>')).toBe('index.html');
    expect(declaredName('/* styles.css */\nbody{}')).toBe('styles.css');
  });

  it('looks only at the opening lines', () => {
    expect(declaredName(`const a = 1;\n${'\n'.repeat(5)}// late.ts`)).toBeNull();
  });

  it('is not fooled by prose, a version number or a bare word', () => {
    expect(declaredName('// This explains the function below\nx')).toBeNull();
    expect(declaredName('// 1.2.3\nx')).toBeNull();
    expect(declaredName('// helpers\nx')).toBeNull();
  });
});

describe('bodyOverlap', () => {
  it('is 1 for identical bodies and 0 for unrelated ones', () => {
    expect(bodyOverlap(lines(6), lines(6))).toBe(1);
    expect(bodyOverlap(lines(6, 'a'), lines(6, 'b'))).toBe(0);
  });

  it('is partial for a revision', () => {
    const before = lines(10);
    const after = `${lines(8)}\nconst extra = true;`;
    const o = bodyOverlap(before, after);
    expect(o).toBeGreaterThan(0.4);
    expect(o).toBeLessThan(1);
  });

  it('is 0 when either side is empty', () => {
    expect(bodyOverlap('', lines(4))).toBe(0);
  });
});

describe('collectArtifacts', () => {
  it('finds nothing in a conversation with no code', () => {
    expect(collectArtifacts([asked('hello'), reply('hi there')])).toEqual([]);
  });

  it('collects a substantial code block', () => {
    const out = collectArtifacts([reply(block('ts', lines(8)))]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ lang: 'ts', kind: 'code', title: 'TypeScript' });
    expect(out[0].versions).toHaveLength(1);
    expect(out[0].versions[0].lines).toBe(8);
  });

  it('ignores a one-liner, but keeps a short page or diagram', () => {
    expect(collectArtifacts([reply(block('ts', 'const a = 1;'))])).toEqual([]);
    expect(collectArtifacts([reply(block('html', '<p>hi</p>'))])).toHaveLength(1);
    expect(collectArtifacts([reply(block('mermaid', 'graph TD; A-->B;'))])).toHaveLength(1);
  });

  it(`takes ${MIN_ARTIFACT_LINES} lines as the floor for ordinary code`, () => {
    expect(collectArtifacts([reply(block('ts', lines(MIN_ARTIFACT_LINES - 1)))])).toEqual([]);
    expect(collectArtifacts([reply(block('ts', lines(MIN_ARTIFACT_LINES)))])).toHaveLength(1);
  });

  it('never collects a block the listener pasted', () => {
    expect(collectArtifacts([asked(block('ts', lines(10)))])).toEqual([]);
  });

  it('never collects a block that is still streaming', () => {
    expect(collectArtifacts([reply(`\`\`\`ts\n${lines(10)}`)])).toEqual([]);
  });

  it('never collects from a failed turn', () => {
    expect(collectArtifacts([{ role: 'assistant', content: block('ts', lines(10)), failed: true }])).toEqual([]);
  });

  it('uses the filename the block declared', () => {
    const out = collectArtifacts([reply(block('ts', `// src/queue.ts\n${lines(8)}`))]);
    expect(out[0].title).toBe('src/queue.ts');
  });

  describe('versions', () => {
    it('groups a revision under the same declared filename', () => {
      const out = collectArtifacts([
        reply(block('ts', `// src/queue.ts\n${lines(8)}`)),
        asked('make it shorter'),
        reply(block('ts', `// src/queue.ts\n${lines(4)}`)),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].versions).toHaveLength(2);
      expect(out[0].versions[0].lines).toBeGreaterThan(out[0].versions[1].lines);
      // Oldest first: the earlier version is still there.
      expect(out[0].versions[0].code).toContain('const x7');
    });

    it('groups a revision with no filename when the bodies are alike', () => {
      const out = collectArtifacts([reply(block('py', lines(10))), reply(block('py', `${lines(9)}\nprint(1)`))]);
      expect(out).toHaveLength(1);
      expect(out[0].versions).toHaveLength(2);
    });

    it('keeps two unrelated blocks in one language apart', () => {
      const out = collectArtifacts([reply(block('ts', lines(8, 'a'))), reply(block('ts', lines(8, 'b')))]);
      expect(out).toHaveLength(2);
      expect(out[1].title).toBe('TypeScript 2');
    });

    it('keeps two differently-named files apart even when alike', () => {
      const out = collectArtifacts([
        reply(block('ts', `// one.ts\n${lines(8)}`)),
        reply(block('ts', `// two.ts\n${lines(8)}`)),
      ]);
      expect(out.map((a) => a.title)).toEqual(['one.ts', 'two.ts']);
    });

    it('does not count an identical re-print as a new version', () => {
      const same = block('ts', `// src/queue.ts\n${lines(8)}`);
      const out = collectArtifacts([reply(same), reply(same)]);
      expect(out[0].versions).toHaveLength(1);
    });

    it('records which message each version came from', () => {
      const out = collectArtifacts([asked('a'), reply(block('ts', `// f.ts\n${lines(8)}`)), asked('b'), reply(block('ts', `// f.ts\n${lines(6)}`))]);
      expect(out[0].versions.map((v) => v.messageIndex)).toEqual([1, 3]);
    });
  });

  it('collects several artifacts from one reply, in order', () => {
    const out = collectArtifacts([reply(`${block('html', '<p>page</p>')}\nand\n${block('python', lines(8, 'p'))}`)]);
    expect(out.map((a) => a.kind)).toEqual(['page', 'code']);
  });
});

describe('kinds, names and previewability', () => {
  it('sorts a language into a kind', () => {
    expect(kindOf('html')).toBe('page');
    expect(kindOf('svg')).toBe('diagram');
    expect(kindOf('mermaid')).toBe('diagram');
    expect(kindOf('md')).toBe('document');
    expect(kindOf('rust')).toBe('code');
  });

  it('builds a sensible download name', () => {
    expect(fileNameFor({ id: 'a', title: 'src/app.ts', lang: 'ts', kind: 'code', versions: [] })).toBe('src/app.ts');
    expect(fileNameFor({ id: 'a', title: 'Page', lang: 'html', kind: 'page', versions: [] })).toBe('page.html');
    expect(fileNameFor({ id: 'a', title: 'Python 2', lang: 'python', kind: 'code', versions: [] })).toBe('python-2.py');
    expect(fileNameFor({ id: 'a', title: '', lang: 'rust', kind: 'code', versions: [] })).toBe('artifact.txt');
  });

  it('offers a preview only for things that can run as a page', () => {
    const make = (lang: string) => ({ id: 'a', title: 't', lang, kind: kindOf(lang), versions: [] });
    expect(isPreviewable(make('html'))).toBe(true);
    expect(isPreviewable(make('svg'))).toBe(true);
    expect(isPreviewable(make('python'))).toBe(false);
    expect(isPreviewable(make('mermaid'))).toBe(false);
  });
});
