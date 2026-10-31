import { describe, expect, it } from 'vitest';
import { groupConversations } from './sidebarGroups';

const c = (id: string, updatedAt: string, starred = false) => ({ id, title: id, starred, activeLeafId: null, createdAt: updatedAt, updatedAt });

describe('groupConversations', () => {
  it('Starred first, then Today, Yesterday, Previous 7 days and Older; empty groups left out', () => {
    const now = new Date(2026, 9, 30, 15, 0);
    const g = groupConversations([
      c('today', new Date(2026, 9, 30, 9, 0).toISOString()),
      c('star-old', new Date(2026, 0, 1).toISOString(), true),
      c('yesterday', new Date(2026, 9, 29, 23, 0).toISOString()),
      c('week', new Date(2026, 9, 24, 12, 0).toISOString()),
      c('old', new Date(2026, 8, 1).toISOString()),
    ], now);
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([
      ['Starred', ['star-old']], ['Today', ['today']], ['Yesterday', ['yesterday']], ['Previous 7 days', ['week']], ['Older', ['old']],
    ]);
    expect(groupConversations([], now)).toEqual([]);
  });
});
