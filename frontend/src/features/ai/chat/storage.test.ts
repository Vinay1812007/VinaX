// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { STORE_KEY, firstName, formatBytes, groupChats, importChats, loadInitialChats, persistChats, storageUsedBytes, timeOfDay } from './storage';
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
    expect(n?.messages).toEqual([
      { role: 'user', content: 'hi', sources: ['https://ok.example'] },
      { role: 'assistant', content: 'yo', steps: [{ tool: 'search', label: 'Searched' }] },
    ]);
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
