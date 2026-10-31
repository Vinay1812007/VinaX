/** VinaX AI — the sidebar's sections: Starred, then Recents by day. */
import type { ConversationSummary } from './types';

export interface SidebarGroup {
  label: 'Starred' | 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';
  items: ConversationSummary[];
}

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Starred first; the rest by last activity in local days. Empty groups are left out. */
export function groupConversations(items: ConversationSummary[], now = new Date()): SidebarGroup[] {
  const today = startOfDay(now);
  const day = 86_400_000;
  const groups: SidebarGroup[] = [
    { label: 'Starred', items: [] },
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ];
  for (const c of items) {
    if (c.starred) { groups[0].items.push(c); continue; }
    const at = startOfDay(new Date(c.updatedAt));
    const g = at >= today ? 1 : at >= today - day ? 2 : at >= today - 7 * day ? 3 : 4;
    groups[g].items.push(c);
  }
  return groups.filter((g) => g.items.length > 0);
}
