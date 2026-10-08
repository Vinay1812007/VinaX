import { describe, expect, it } from 'vitest';
import type { Msg } from './types';
import { MAX_VERSIONS, MAX_VERSION_DEPTH, editedMessage, reviveVersions, showVersion, versionOf } from './versions';

const thread = (): Msg[] => [
  { role: 'user', content: 'first question', images: ['data:image/png;base64,AAA'] },
  { role: 'assistant', content: 'first answer' },
  { role: 'user', content: 'second question' },
  { role: 'assistant', content: 'second answer' },
];

describe('11.2 — editing a message in place keeps its earlier versions', () => {
  it('the edited message holds the old text and the turns that followed it; pictures stay', () => {
    const m = thread();
    const user = editedMessage(m, 0, 'better question');
    expect(user.content).toBe('better question');
    expect(user.images).toEqual(['data:image/png;base64,AAA']);
    expect(user.version).toBe(1);
    expect(user.versions).toHaveLength(2);
    expect(user.versions?.[0]).toEqual({ content: 'first question', images: ['data:image/png;base64,AAA'], after: m.slice(1) });
    expect(user.versions?.[1].after).toEqual([]);
    expect(versionOf(user)).toEqual({ at: 1, count: 2 });
    expect(versionOf(m[0])).toEqual({ at: 0, count: 1 });
  });

  it('switching brings back that version’s text and turns, and puts the shown one away', () => {
    const m = thread();
    const edited: Msg[] = [editedMessage(m, 0, 'better question'), { role: 'assistant', content: 'better answer' }];
    const back = showVersion(edited, 0, 0);
    expect(back?.map((x) => x.content)).toEqual(['first question', 'first answer', 'second question', 'second answer']);
    expect(back?.[0].version).toBe(0);
    expect(back?.[0].versions?.[0].after).toEqual([]);
    expect(back?.[0].versions?.[1].after.map((x) => x.content)).toEqual(['better answer']);
    const forward = showVersion(back as Msg[], 0, 1);
    expect(forward?.map((x) => x.content)).toEqual(['better question', 'better answer']);
    // Nothing to switch to: same version, out of range, or never edited.
    expect(showVersion(edited, 0, 1)).toBeNull();
    expect(showVersion(edited, 0, 5)).toBeNull();
    expect(showVersion(m, 2, 0)).toBeNull();
  });

  it('keeps at most MAX_VERSIONS, dropping the oldest', () => {
    let m: Msg[] = [{ role: 'user', content: 'v0' }, { role: 'assistant', content: 'a0' }];
    for (let k = 1; k <= MAX_VERSIONS + 3; k += 1) m = [editedMessage(m, 0, `v${k}`), { role: 'assistant', content: `a${k}` }];
    expect(m[0].versions).toHaveLength(MAX_VERSIONS);
    expect(m[0].version).toBe(MAX_VERSIONS - 1);
    expect(m[0].versions?.[0].content).toBe('v4');
    expect(m[0].content).toBe(`v${MAX_VERSIONS + 3}`);
  });

  it('reads stored versions back checked: bad entries go, the index is clamped, remote pictures are refused, depth is bounded', () => {
    const plain = (x: unknown): Msg | null =>
      x && typeof x === 'object' && typeof (x as Msg).content === 'string' ? { role: (x as Msg).role, content: (x as Msg).content } : null;
    const out = reviveVersions(
      [{ content: 'a', images: ['https://tracker.example/p.png', ''], after: [{ role: 'assistant', content: 'x' }, 42] }, 'junk', { content: 7 }, { content: 'b', after: 'no' }],
      99,
      plain,
    );
    expect(out.version).toBe(1);
    expect(out.versions).toEqual([
      { content: 'a', images: [''], after: [{ role: 'assistant', content: 'x' }] },
      { content: 'b', after: [] },
    ]);
    expect(reviveVersions([{ content: 'only one', after: [] }], 0, plain)).toEqual({});
    expect(reviveVersions('nope', 0, plain)).toEqual({});
    expect(reviveVersions([{ content: 'a', after: [] }, { content: 'b', after: [] }], 0, plain, MAX_VERSION_DEPTH)).toEqual({});
  });
});
