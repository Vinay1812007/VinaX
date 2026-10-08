// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { STORE_KEY, exportAllChats, firstName, formatBytes, groupChats, importChats, loadInitialChats, persistChats, storageUsedBytes, timeOfDay, titleFromMessage } from './storage';
import type { Conversation } from './types';

const chat = (id: string, updatedAt: number, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  title: `Chat ${id}`,
  messages: [{ role: 'user', content: `hello from ${id}` }],
  updatedAt,
  ...extra,
});

beforeEach(() => localStorage.clear());

describe('groupChats', () => {
  const now = new Date(2026, 8, 17, 15, 0, 0).getTime();
  const day = 86_400_000;
  it('groups by when a chat was last touched, pinned first', () => {
    const groups = groupChats(
      [chat('a', now - 1000), chat('b', now - day), chat('c', now - 3 * day), chat('d', now - 30 * day), chat('e', now - 30 * day, { pinned: true })],
      '',
      now,
    );
    expect(groups.map(([label, list]) => [label, list.map((c) => c.id)])).toEqual([
      ['Pinned', ['e']],
      ['Today', ['a']],
      ['Yesterday', ['b']],
      ['Previous 7 days', ['c']],
      ['Older', ['d']],
    ]);
  });
  it('searches titles and message text', () => {
    expect(groupChats([chat('a', now), chat('b', now)], 'from B', now)[0][1].map((c) => c.id)).toEqual(['b']);
    expect(groupChats([chat('a', now)], 'nothing', now)).toEqual([]);
  });
});

describe('persistence', () => {
  it('keeps the stored shape, drops image data, and folds stacked blank chats into one', () => {
    persistChats([
      { id: 'x', title: 'New chat', messages: [], updatedAt: 1 },
      { id: 'y', title: 'New chat', messages: [], updatedAt: 2 },
      { ...chat('z', 3), messages: [{ role: 'user', content: 'pic', images: ['data:image/png;base64,AAAA'] }] },
    ]);
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as Conversation[];
    expect(raw[2].messages[0].images).toEqual(['']);
    expect(loadInitialChats().map((c) => c.id)).toEqual(['x', 'z']);
  });
  it('starts with one fresh chat when nothing is stored or the store is corrupt', () => {
    localStorage.setItem(STORE_KEY, '{not json');
    const chats = loadInitialChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].messages).toEqual([]);
  });
  it('measures what the chat keeps on the device', () => {
    expect(storageUsedBytes()).toBe(0);
    localStorage.setItem('unrelated', 'x'.repeat(100));
    localStorage.setItem('vinax.aiProfile', 'abcd');
    expect(storageUsedBytes()).toBe(('vinax.aiProfile'.length + 4) * 2);
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('importChats', () => {
  it('adds new chats, leaves existing ones alone, and validates every field', () => {
    const existing = [chat('a', 10)];
    const file = JSON.stringify([
      chat('a', 999),
      { id: 'n', title: '  Trip  ', updatedAt: 20, pinned: true, messages: [{ role: 'user', content: 'hi', rating: 'sideways', sources: ['javascript:alert(1)', 'https://ok.example'] }, { role: 'system', content: 'x' }, { role: 'assistant', content: 'yo', steps: [{ tool: 'search', label: 'Searched' }, { tool: 'x' }] }] },
      { id: 'empty', messages: [] },
      'junk',
    ]);
    const out = importChats(file, existing);
    expect(out?.added).toBe(1);
    expect(out?.chats.map((c) => c.id)).toEqual(['n', 'a']);
    const n = out?.chats[0];
    expect(n).toMatchObject({ title: 'Trip', pinned: true });
    // 10.2 — the retired source and step fields are never revived.
    expect(n?.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'yo' },
    ]);
  });
  it('drops the retired source and step fields from chats an older build saved', () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        {
          id: 'old',
          title: 'Old',
          updatedAt: 1,
          messages: [
            { role: 'user', content: 'q' },
            { role: 'assistant', content: 'a', engine: 'Balanced', sources: ['https://a.example'], sourcePreviews: [{ url: 'https://a.example', title: 'T', snippet: 's' }], steps: [{ tool: 'search', label: 'x' }] },
          ],
        },
      ]),
    );
    expect(loadInitialChats()[0].messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a', engine: 'Balanced' },
    ]);
  });
  it('keeps a web-grounded reply’s sources (11.0 shape, 11.2 supports) across a reload and an import, validated', () => {
    const sources = {
      items: [{ url: 'https://a.example/p', title: 'a.example' }, { url: 'javascript:alert(1)', title: 'bad' }, { url: 'https://b.example/q', title: 'B' }],
      queries: ['q'],
      entry: '<div>s</div>',
      supports: [{ text: 'It rains.', sources: [0, 1] }, { text: 'Hot.', sources: [2] }],
    };
    const kept = {
      items: [{ url: 'https://a.example/p', title: 'a.example' }, { url: 'https://b.example/q', title: 'B' }],
      queries: ['q'],
      entry: '<div>s</div>',
      supports: [{ text: 'It rains.', sources: [0] }, { text: 'Hot.', sources: [1] }],
    };
    const saved = [{ id: 'w', title: 'W', updatedAt: 1, messages: [{ role: 'user', content: 'rain?', sources }, { role: 'assistant', content: 'It rains. Hot.', sources }] }];
    localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    expect(loadInitialChats()[0].messages).toEqual([
      { role: 'user', content: 'rain?' },
      { role: 'assistant', content: 'It rains. Hot.', sources: kept },
    ]);
    expect(importChats(JSON.stringify(saved), [])?.chats[0].messages[1].sources).toEqual(kept);
  });
  it('refuses a file that is not a chats export', () => {
    expect(importChats('not json', [])).toBeNull();
    expect(importChats('{"a":1}', [])).toBeNull();
    expect(importChats('[]', [])).toEqual({ chats: [], added: 0 });
  });
});

describe('greeting helpers', () => {
  it('uses the first name and the time of day', () => {
    expect(firstName('  Chandra Sekhar K ')).toBe('Chandra');
    expect(firstName('')).toBe('');
    expect(timeOfDay(new Date(2026, 0, 1, 9))).toBe('morning');
    expect(timeOfDay(new Date(2026, 0, 1, 13))).toBe('afternoon');
    expect(timeOfDay(new Date(2026, 0, 1, 21))).toBe('evening');
  });
});

describe('9.1 — temporary chats are never written to the device', () => {
  it('is left out of what persists, while ordinary chats are kept', () => {
    persistChats([chat('temp', 2, { temporary: true }), chat('kept', 1)]);
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as Conversation[];
    expect(stored.map((c) => c.id)).toEqual(['kept']);
  });

  it('does not come back after a reload', () => {
    persistChats([chat('temp', 2, { temporary: true })]);
    // Nothing stored at all, so a fresh load starts with one blank chat.
    const loaded = loadInitialChats();
    expect(loaded.every((c) => c.id !== 'temp')).toBe(true);
  });

  it('is left out of an export', () => {
    // Capture the bytes exportAllChats hands the browser, without downloading.
    let body = '';
    const realBlob = globalThis.Blob;
    const realCreateObjectURL = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    const realCreate = document.createElement.bind(document);
    globalThis.Blob = class extends realBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        body = parts.map(String).join('');
      }
    } as unknown as typeof Blob;
    URL.createObjectURL = (() => 'blob:stub') as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    document.createElement = ((tag: string) => {
      const el = realCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') el.click = () => undefined;
      return el;
    }) as typeof document.createElement;
    try {
      exportAllChats([chat('temp', 2, { temporary: true }), chat('kept', 1)]);
    } finally {
      globalThis.Blob = realBlob;
      URL.createObjectURL = realCreateObjectURL;
      URL.revokeObjectURL = realRevoke;
      document.createElement = realCreate;
    }
    expect(body).toContain('"kept"');
    expect(body).not.toContain('"temp"');
  });

  it('an import never revives one (the flag is not part of the wire format)', () => {
    const result = importChats(JSON.stringify([{ id: 'x', title: 'X', messages: [{ role: 'user', content: 'hi' }], updatedAt: 1, temporary: true }]), []);
    expect(result?.chats[0].temporary).toBeUndefined();
  });
});

describe('11.0 — a reply interrupted by a reload', () => {
  it('comes back as a failed turn, not an endless thinking mark, and loses its turn tag', () => {
    const chat = {
      id: 'c1',
      title: 'Cut off',
      updatedAt: 1,
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'kept', turn: 'abc-1' },
        { role: 'user', content: 'again' },
        { role: 'assistant', content: '', turn: 'abc-2' },
      ],
    };
    localStorage.setItem(STORE_KEY, JSON.stringify([chat]));
    const [loaded] = loadInitialChats();
    expect(loaded.messages[1]).toEqual({ role: 'assistant', content: 'kept' });
    expect(loaded.messages[3]).toEqual({ role: 'assistant', content: '', failed: true });
  });
});

describe('a chat title from its first message (11.0)', () => {
  it('keeps a short message whole, on one line', () => {
    expect(titleFromMessage('  Plan a\n trip  ')).toBe('Plan a trip');
  });
  it('cuts at a word boundary and says so with an ellipsis', () => {
    const t = titleFromMessage('Explain how the recommendation engine balances familiarity and novelty');
    expect(t).toBe('Explain how the recommendation engine…');
    expect(Array.from(t).length).toBeLessThanOrEqual(43);
  });
  it('one very long word is cut at the limit, still with an ellipsis', () => {
    expect(titleFromMessage('x'.repeat(60))).toBe(`${'x'.repeat(42)}…`);
  });
  it('never splits a conjunct or an emoji', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(titleFromMessage(family.repeat(50))).toBe(`${family.repeat(42)}…`);
    const telugu = titleFromMessage('క్ష'.repeat(50));
    expect(telugu).toBe(`${'క్ష'.repeat(42)}…`);
  });
});

describe('11.2 — an edited message’s versions are kept with the chat', () => {
  const edited = (): Conversation => ({
    id: 'e1',
    title: 'Edited',
    updatedAt: 1,
    messages: [
      {
        role: 'user',
        content: 'new text',
        images: ['data:image/png;base64,AAA'],
        version: 1,
        versions: [
          { content: 'old text', images: ['data:image/png;base64,AAA'], after: [{ role: 'assistant', content: 'old answer', engine: 'Alpha 70B' }] },
          { content: 'new text', images: ['data:image/png;base64,AAA'], after: [] },
        ],
      },
      { role: 'assistant', content: 'new answer' },
    ],
  });

  it('survives a save and a reload, with picture data stripped inside versions too', () => {
    persistChats([edited()]);
    const raw = localStorage.getItem(STORE_KEY) ?? '';
    expect(raw).not.toContain('base64');
    const [c] = loadInitialChats();
    expect(c.messages[0].version).toBe(1);
    expect(c.messages[0].versions?.map((v) => v.content)).toEqual(['old text', 'new text']);
    expect(c.messages[0].versions?.[0].after).toEqual([{ role: 'assistant', content: 'old answer', engine: 'Alpha 70B' }]);
    expect(c.messages[0].versions?.[0].images).toEqual(['']);
  });

  it('a malformed stored list is dropped and a bad index is clamped on load', () => {
    const c = edited();
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        { ...c, messages: [{ ...c.messages[0], version: 'x' }, c.messages[1]] },
        { id: 'bad', title: 'Bad', updatedAt: 1, messages: [{ role: 'user', content: 'hi', versions: 'oops', version: 3 }, { role: 'assistant', content: 'yo', versions: [] }] },
      ]),
    );
    const [good, bad] = loadInitialChats();
    expect(good.messages[0].version).toBe(1);
    expect(good.messages[0].versions).toHaveLength(2);
    expect(bad.messages[0]).toEqual({ role: 'user', content: 'hi' });
    expect(bad.messages[1]).toEqual({ role: 'assistant', content: 'yo' });
  });

  it('an import revives versions field by field', () => {
    const out = importChats(JSON.stringify([edited()]), []);
    const m = out?.chats[0].messages[0];
    expect(m?.version).toBe(1);
    expect(m?.versions?.[0].after).toEqual([{ role: 'assistant', content: 'old answer', engine: 'Alpha 70B' }]);
  });
});

