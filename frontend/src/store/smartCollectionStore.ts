import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  SMART_COLLECTIONS_KEY,
  SMART_MAX,
  SMART_RULES_VERSION,
  sanitizeRules,
  sanitizeSmartCollections,
  type SmartCollection,
  type SmartRules,
  type SmartSort,
} from '@/features/library/smartCollections';
import { guardedLocalStorage } from '@/services/storage/local';

interface SmartCollectionState {
  rules: SmartCollection[];
  create(input: { name: string; rules: SmartRules; sort?: SmartSort; limit?: number; emoji?: string }): string;
  update(id: string, patch: Partial<Omit<SmartCollection, 'id' | 'version' | 'createdAt'>>): void;
  remove(id: string): SmartCollection | null;
  restore(def: SmartCollection): void;
}

export const useSmartCollectionStore = create<SmartCollectionState>()(
  persist(
    (set, get) => ({
      rules: [],
      create: ({ name, rules, sort = 'recent', limit = 0, emoji }) => {
        const id = `smart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const def: SmartCollection = {
          id,
          name: name.trim().slice(0, 80) || 'Smart collection',
          createdAt: Date.now(),
          version: SMART_RULES_VERSION,
          rules: sanitizeRules(rules),
          sort,
          limit: Math.max(0, Math.min(1000, Math.round(limit))),
          ...(emoji?.trim() ? { emoji: emoji.trim().slice(0, 8) } : {}),
        };
        set({ rules: [...get().rules, def].slice(0, SMART_MAX) });
        return id;
      },
      update: (id, patch) =>
        set({
          rules: get().rules.map((c) => {
            if (c.id !== id) return c;
            const next: SmartCollection = { ...c };
            if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 80) || c.name;
            if (patch.rules !== undefined) next.rules = sanitizeRules(patch.rules);
            if (patch.sort !== undefined) next.sort = patch.sort;
            if (patch.limit !== undefined) next.limit = Math.max(0, Math.min(1000, Math.round(patch.limit)));
            if (patch.emoji !== undefined) {
              const e = patch.emoji.trim().slice(0, 8);
              if (e) next.emoji = e;
              else delete next.emoji;
            }
            return next;
          }),
        }),
      remove: (id) => {
        const victim = get().rules.find((c) => c.id === id) ?? null;
        if (victim) set({ rules: get().rules.filter((c) => c.id !== id) });
        return victim;
      },
      restore: (def) => {
        if (get().rules.some((c) => c.id === def.id)) return;
        set({ rules: [...get().rules, def].slice(0, SMART_MAX) });
      },
    }),
    {
      name: SMART_COLLECTIONS_KEY,
      storage: createJSONStorage(() => guardedLocalStorage),
      version: 1,
      // Any stored shape is migrated/sanitised on the way in, never trusted.
      merge: (persisted, current) => {
        const p = persisted && typeof persisted === 'object' ? (persisted as { rules?: unknown }) : {};
        return { ...current, rules: sanitizeSmartCollections(p.rules) };
      },
      migrate: (persisted) => persisted as { rules: SmartCollection[] },
    },
  ),
);
