import { describe, expect, it } from 'vitest';
import { activeMap, classify, filterMediaLists, filterUsable, healthKey, nextEntry, usable, type HealthMap } from './modelHealth';

const NOW = Date.parse('2026-10-30T10:00:00Z');
const map = (models: HealthMap['models'], extra: Partial<HealthMap> = {}): HealthMap => ({ v: 1, checkedAt: NOW - 60_000, fullPassAt: NOW - 3_600_000, models, ...extra });
const ok = { ok: true, reason: null, at: NOW, fails: 0 } as const;
const dead = { ok: false, reason: 'gone', at: NOW, fails: 1 } as const;

describe('classify', () => {
  it('reads a check from the status and whether anything came back', () => {
    expect(classify(200, true)).toBeNull();
    expect(classify(200, false)).toBe('empty');
    expect(classify(404, false)).toBe('gone');
    expect(classify(400, false)).toBe('gone');
    expect(classify(403, false)).toBe('refused');
    expect(classify(402, false)).toBe('not_free');
    expect(classify(429, false)).toBe('busy');
    expect(classify(503, false)).toBe('down');
    expect(classify(0, false)).toBe('down');
  });
});

describe('nextEntry', () => {
  it('hides a model on a hard failure at once', () => {
    expect(nextEntry(ok, 'gone', NOW)).toMatchObject({ ok: false, reason: 'gone', fails: 1 });
  });
  it('lets a model that used to pass survive one busy or down check, not two', () => {
    const once = nextEntry(ok, 'busy', NOW);
    expect(once).toMatchObject({ ok: true, fails: 1 });
    expect(nextEntry(once, 'down', NOW)).toMatchObject({ ok: false, fails: 2 });
  });
  it('never shows a model that has not passed yet', () => {
    expect(nextEntry(undefined, 'busy', NOW).ok).toBe(false);
    expect(nextEntry(dead, null, NOW)).toEqual({ ok: true, reason: null, at: NOW, fails: 0 });
  });
});

describe('usable', () => {
  it('offers everything with no record, or a record older than a day', () => {
    expect(usable(null, 'chat', 'nvidia', 'x', NOW)).toBe(true);
    expect(usable(map({ [healthKey('chat', 'nvidia', 'x')]: dead }, { checkedAt: NOW - 25 * 3_600_000 }), 'chat', 'nvidia', 'x', NOW)).toBe(true);
    expect(activeMap(map({}, { checkedAt: NOW - 25 * 3_600_000 }), NOW)).toBeNull();
  });
  it('follows the last check, and holds back unchecked models only after the first full pass', () => {
    const m = map({ [healthKey('chat', 'nvidia', 'good')]: ok, [healthKey('chat', 'nvidia', 'bad')]: dead });
    expect(usable(m, 'chat', 'nvidia', 'good', NOW)).toBe(true);
    expect(usable(m, 'chat', 'nvidia', 'bad', NOW)).toBe(false);
    expect(usable(m, 'chat', 'nvidia', 'new', NOW)).toBe(false);
    expect(usable({ ...m, fullPassAt: null }, 'chat', 'nvidia', 'new', NOW)).toBe(true);
  });
});

describe('filters', () => {
  const m = map({ [healthKey('chat', 'groq', 'a')]: ok, [healthKey('chat', 'groq', 'b')]: dead, [healthKey('image', 'nvidia', 'flux')]: dead, [healthKey('speech', 'groq', 'orpheus')]: ok });
  it('keeps only the chat models that answered', () => {
    expect(filterUsable(m, 'chat', { groq: [{ id: 'a' }, { id: 'b' }], nvidia: [] }, NOW)).toEqual({ groq: [{ id: 'a' }], nvidia: [] });
  });
  it('never empties the whole chat menu, but lets a media kind go empty', () => {
    const allDead = map({ [healthKey('chat', 'groq', 'b')]: dead });
    expect(filterUsable(allDead, 'chat', { groq: [{ id: 'b' }] }, NOW)).toEqual({ groq: [{ id: 'b' }] });
    expect(filterUsable(m, 'image', { nvidia: [{ id: 'flux' }] }, NOW)).toEqual({ nvidia: [] });
  });
  it('filters the checked media kinds and passes the others through', () => {
    const lists = {
      nvidia: [{ id: 'flux', kind: 'image' }, { id: 'embed', kind: 'embedding' }],
      groq: [{ id: 'orpheus', kind: 'speech' }],
    };
    expect(filterMediaLists(m, lists, NOW)).toEqual({ nvidia: [{ id: 'embed', kind: 'embedding' }], groq: [{ id: 'orpheus', kind: 'speech' }] });
    const later = NOW + 30 * 24 * 3_600_000;
    expect(filterMediaLists(null, lists, later)).toBe(lists);
  });
});

describe('the 2026-10-30 seed', () => {
  const dead = 'google/codegemma-1.1-7b';
  const alive = 'openai/gpt-oss-20b';
  it('hides the models that failed the full test before the job has checked them', () => {
    expect(usable(null, 'chat', 'nvidia', dead, NOW)).toBe(false);
    expect(usable(null, 'chat', 'groq', alive, NOW)).toBe(true);
    expect(usable(null, 'image', 'nvidia', 'black-forest-labs/flux.1-schnell', NOW)).toBe(false);
    expect(usable(null, 'chat', 'nvidia', 'a-model-added-later', NOW)).toBe(true);
  });
  it('gives way to the job’s own check, and expires after two weeks', () => {
    const m = map({ [healthKey('chat', 'nvidia', dead)]: ok });
    expect(usable(m, 'chat', 'nvidia', dead, NOW)).toBe(true);
    expect(usable(null, 'chat', 'nvidia', dead, NOW + 15 * 24 * 3_600_000)).toBe(true);
  });
});
