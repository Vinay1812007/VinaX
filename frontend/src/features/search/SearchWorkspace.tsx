import { useState } from 'react';
import type { Song } from '@/types';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useSearchStore } from '@/store/searchStore';
import { useSearchWorkspaceStore, type SearchPreset } from '@/store/searchWorkspaceStore';
import { activeFilterCount, resultsCsv, shuffledSongs } from './workspace';
import { toast } from '@/store/toastStore';

export function SavedSearches({ onOpen }: { onOpen: (preset: SearchPreset) => void }) {
  const presets = useSearchWorkspaceStore((s) => s.presets);
  const rename = useSearchWorkspaceStore((s) => s.renamePreset);
  const remove = useSearchWorkspaceStore((s) => s.removePreset);
  const [editing, setEditing] = useState<string | null>(null);
  if (!presets.length) return null;
  return (
    <section className="search-saved" aria-label="Saved searches">
      <div className="search-section-heading">
        <h2>Your search shortcuts</h2>
        <span>{presets.length}/20 saved</span>
      </div>
      <div className="search-preset-grid">
        {presets.map((p) => (
          <div key={p.id} className="search-preset">
            {editing === p.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  rename(p.id, String(data.get('name')));
                  setEditing(null);
                }}
              >
                <input
                  aria-label="Search shortcut name"
                  name="name"
                  defaultValue={p.name}
                  maxLength={60}
                  autoFocus
                />
                <button type="submit">Save name</button>
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <button className="search-preset-open" onClick={() => onOpen(p)}>
                  <span>↗</span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.query} · {activeFilterCount(p.filters)} filters
                  </small>
                </button>
                <div className="search-preset-actions">
                  <button aria-label={`Rename ${p.name}`} onClick={() => setEditing(p.id)}>
                    Rename
                  </button>
                  <button aria-label={`Delete ${p.name}`} onClick={() => remove(p.id)}>
                    Remove
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function SearchWorkspace({
  query,
  songs,
  total,
  language,
}: {
  query: string;
  songs: Song[];
  total: number;
  language: string | null;
}) {
  const filters = useSearchWorkspaceStore((s) => s.filters);
  const setFilters = useSearchWorkspaceStore((s) => s.setFilters);
  const reset = useSearchWorkspaceStore((s) => s.resetFilters);
  const compact = useSearchWorkspaceStore((s) => s.compact);
  const toggleCompact = useSearchWorkspaceStore((s) => s.toggleCompact);
  const save = useSearchWorkspaceStore((s) => s.savePreset);
  const sort = useSearchStore((s) => s.songSort);
  const [expanded, setExpanded] = useState(false);
  const [collectionName, setCollectionName] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState('');
  const count = activeFilterCount(filters);
  const addFavorites = () => {
    const lib = useLibraryStore.getState();
    const ids = new Set(lib.favorites.map((s) => s.id));
    const fresh = songs.filter((s) => !ids.has(s.id));
    fresh.forEach(lib.toggleFavorite);
    toast(`Added ${fresh.length} songs to favorites`);
  };
  const addLater = () => {
    const lib = useLibraryStore.getState();
    const ids = new Set(lib.later.map((s) => s.id));
    const fresh = songs.filter((s) => !ids.has(s.id)).slice(0, Math.max(0, 500 - lib.later.length));
    fresh.forEach(lib.toggleLater);
    toast(`Saved ${fresh.length} songs for later`);
  };
  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + resultsCsv(songs)], { type: 'text/csv;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vinax-search-results.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="search-workspace" aria-label="Refine search results">
      <div className="search-workspace-bar">
        <div role="status">
          <strong>{songs.length}</strong>
          <span> of {total} loaded songs</span>
        </div>
        <div className="search-workspace-actions">
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls="search-refinements"
          >
            Refine {count > 0 && <b>{count}</b>} <span aria-hidden>⌄</span>
          </button>
          <button onClick={toggleCompact} aria-pressed={compact}>
            Compact
          </button>
          <button onClick={() => setSaving(!saving)} aria-expanded={saving}>
            ＋ Save search
          </button>
        </div>
      </div>
      {saving && (
        <form
          className="search-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            save({ name: presetName || query, query, filters: { ...filters }, sort, language });
            setSaving(false);
            setPresetName('');
            toast('Search shortcut saved on this device');
          }}
        >
          <input
            aria-label="Saved search name"
            placeholder="Name this search"
            maxLength={60}
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
          />
          <button type="submit">Save shortcut</button>
        </form>
      )}
      {expanded && (
        <div id="search-refinements" className="search-refinements">
          <div className="search-filter-fields">
            <label>
              Release decade
              <select
                value={filters.decade}
                onChange={(e) => setFilters({ decade: e.target.value })}
              >
                <option value="">Every era</option>
                {['2020', '2010', '2000', '1990', '1980', '1970', '1960', '1950'].map((v) => (
                  <option key={v} value={v}>
                    {v}s
                  </option>
                ))}
              </select>
            </label>
            <label>
              Song length
              <select
                value={filters.duration}
                onChange={(e) =>
                  setFilters({ duration: e.target.value as typeof filters.duration })
                }
              >
                <option value="any">Any length</option>
                <option value="short">Under 3 minutes</option>
                <option value="medium">3–5 minutes</option>
                <option value="long">Over 5 minutes</option>
              </select>
            </label>
          </div>
          <div className="search-toggle-filters">
            {(
              [
                ['lyrics', 'Lyrics available'],
                ['clean', 'Hide explicit'],
                ['favorites', 'My favorites'],
                ['unheard', 'Outside recent history'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={filters[key]}
                  onChange={(e) => setFilters({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
          <p>
            Filters apply to loaded songs and catalog metadata. History covers the last 150 plays on
            this device.
          </p>
        </div>
      )}
      {count > 0 && (
        <button className="search-reset" onClick={reset}>
          Clear {count} refinements ×
        </button>
      )}
      <div className="search-bulk" aria-label="Actions for filtered songs">
        <button
          disabled={!songs.length}
          onClick={() => usePlayerStore.getState().playQueue(shuffledSongs(songs), 0)}
        >
          ⇄ Shuffle results
        </button>
        <button disabled={!songs.length} onClick={addFavorites}>
          ♡ Favorite results
        </button>
        <button disabled={!songs.length} onClick={addLater}>
          ＋ Listen later
        </button>
        <button
          disabled={!songs.length}
          onClick={() => setCreating(!creating)}
          aria-expanded={creating}
        >
          New collection
        </button>
        <button disabled={!songs.length} onClick={exportCsv}>
          Export CSV ↓
        </button>
      </div>
      {creating && (
        <form
          className="search-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!collectionName.trim()) return;
            const lib = useLibraryStore.getState();
            const id = lib.createCollection(collectionName.trim());
            songs.forEach((s) => lib.addToCollection(id, s));
            setCreating(false);
            setCollectionName('');
            toast(`Collection created with ${songs.length} songs`);
          }}
        >
          <input
            aria-label="Collection name"
            placeholder="Give your collection a name"
            required
            maxLength={80}
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
          />
          <button type="submit" disabled={!songs.length}>
            Create collection
          </button>
        </form>
      )}
    </section>
  );
}
