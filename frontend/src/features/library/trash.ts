/**
 * v5.17.0 — recently-deleted collections. Deleting a collection parks it here
 * for a week (newest first, at most 20) so a slip of the finger is undoable.
 * Pure helpers; the library store owns the persisted list.
 */
import type { LocalCollection } from '@/store/libraryStore';

export interface TrashEntry {
  collection: LocalCollection;
  deletedAt: number;
}

export const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const TRASH_MAX = 20;

/** Drops expired entries, sorts newest first and caps the list. */
export function pruneTrash(entries: TrashEntry[] | undefined, now = Date.now()): TrashEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(
      (e): e is TrashEntry =>
        !!e &&
        typeof e === 'object' &&
        !!e.collection &&
        typeof e.collection.id === 'string' &&
        typeof e.deletedAt === 'number' &&
        now - e.deletedAt < TRASH_TTL_MS,
    )
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, TRASH_MAX);
}

/** Whole days until an entry is purged (never below 1 while it still exists). */
export function trashDaysLeft(deletedAt: number, now = Date.now()): number {
  const left = TRASH_TTL_MS - (now - deletedAt);
  return Math.max(1, Math.ceil(left / (24 * 60 * 60 * 1000)));
}
