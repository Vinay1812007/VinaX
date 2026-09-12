import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_FILTERS, sanitizeFilters, type SearchFilters } from '@/features/search/workspace';
import { isSongSort, type SongSort } from './searchStore';

export interface SearchPreset {
  id: string;
  name: string;
  query: string;
  filters: SearchFilters;
  sort: SongSort;
  language: string | null;
}
interface WorkspaceState {
  filters: SearchFilters;
  compact: boolean;
  presets: SearchPreset[];
  setFilters(filters: Partial<SearchFilters>): void;
  resetFilters(): void;
  toggleCompact(): void;
  savePreset(preset: Omit<SearchPreset, 'id'>): void;
  renamePreset(id: string, name: string): void;
  removePreset(id: string): void;
}
export const useSearchWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      filters: { ...DEFAULT_FILTERS },
      compact: false,
      presets: [],
      setFilters: (filters) =>
        set((s) => ({ filters: sanitizeFilters({ ...s.filters, ...filters }) })),
      resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),
      toggleCompact: () => set((s) => ({ compact: !s.compact })),
      savePreset: (preset) =>
        set((s) => ({
          presets: [
            {
              ...preset,
              name: preset.name.trim().slice(0, 60) || preset.query,
              id: crypto.randomUUID(),
            },
            ...s.presets,
          ].slice(0, 20),
        })),
      renamePreset: (id, name) =>
        set((s) => ({
          presets: s.presets.map((p) =>
            p.id === id ? { ...p, name: name.trim().slice(0, 60) || p.name } : p,
          ),
        })),
      removePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
    }),
    {
      name: 'vinax.search.workspace.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ compact: s.compact, presets: s.presets }),
      merge: (value, current) => {
        const p = (value ?? {}) as Partial<WorkspaceState>;
        const presets = (Array.isArray(p.presets) ? p.presets : [])
          .filter(
            (v) =>
              v &&
              typeof v.id === 'string' &&
              typeof v.query === 'string' &&
              typeof v.name === 'string',
          )
          .slice(0, 20)
          .map((v) => ({
            ...v,
            name: v.name.slice(0, 60),
            query: v.query.slice(0, 120),
            filters: sanitizeFilters(v.filters),
            sort: isSongSort(v.sort) ? v.sort : ('relevance' as const),
            language: typeof v.language === 'string' ? v.language : null,
          }));
        return { ...current, compact: p.compact === true, presets };
      },
    },
  ),
);
