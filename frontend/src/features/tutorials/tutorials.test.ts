import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TUTORIALS, tutorialById } from './tutorials';

/** Every non-test source file except the tour definitions themselves. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name) && !p.endsWith('tutorials.ts')) out.push(readFileSync(p, 'utf8'));
  }
  return out;
}
const SRC = sources(join(process.cwd(), 'src')).join('\n');
const steps = TUTORIALS.flatMap((t) => t.steps.map((s, i) => ({ where: `${t.id} #${i + 1}`, ...s })));

describe('guided tours', () => {
  it('covers the 11.0 additions and keeps the older tours', () => {
    expect(TUTORIALS.map((t) => t.id)).toEqual([
      'first-song', 'find-anything', 'listen-together', 'meet-ai', 'ai-styles', 'app-look', 'festival-themes', 'make-it-yours', 'save-organise',
    ]);
    expect(new Set(TUTORIALS.map((t) => t.id)).size).toBe(TUTORIALS.length);
    expect(tutorialById('app-look')?.title).toBe('Change the app’s look');
    expect(tutorialById('nope')).toBeNull();
  });

  it.each(steps)('$where: a title of at most 5 words and one or two plain sentences', (s) => {
    expect(s.title.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
    const sentences = s.body.replace(/“[^”]*”/g, 'x').split(/[.?](?:\s|$)/).filter((x) => x.trim());
    expect(sentences.length).toBeGreaterThanOrEqual(1);
    expect(sentences.length).toBeLessThanOrEqual(2);
    expect(`${s.title} ${s.body} ${s.tip ?? ''}`).not.toContain('!');
  });

  it('every data-tour id a tour points at exists in the source', () => {
    const ids = new Set(steps.flatMap((s) => [...(s.target ?? '').matchAll(/data-tour="([^"]+)"/g)].map((m) => m[1])));
    expect(ids.size).toBeGreaterThan(3);
    for (const id of ids) expect(SRC, `data-tour="${id}"`).toMatch(new RegExp(`(data-tour|dataTour)="${id}"`));
  });

  it('every aria-label, id and class a tour points at exists in the source', () => {
    for (const s of steps) {
      const sel = s.target ?? '';
      for (const m of sel.matchAll(/aria-label[\^]?="([^"]+)"/g)) expect(SRC, `${s.where}: label ${m[1]}`).toContain(m[1]);
      for (const m of sel.matchAll(/aria-labelledby="([^"]+)"/g)) expect(SRC, `${s.where}: id ${m[1]}`).toContain(m[1]);
      for (const m of sel.matchAll(/#([\w-]+)/g)) expect(SRC, `${s.where}: #${m[1]}`).toContain(m[1]);
      for (const m of sel.matchAll(/\.(vx-[\w-]+)/g)) expect(SRC, `${s.where}: .${m[1]}`).toContain(m[1]);
    }
  });
});
