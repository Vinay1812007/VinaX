// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { useSearchWorkspaceStore as store } from './searchWorkspaceStore';
import { DEFAULT_FILTERS } from '@/features/search/workspace';
beforeEach(() => {
  localStorage.clear();
  store.setState({ presets: [], filters: { ...DEFAULT_FILTERS }, compact: false });
});
it('saves an independent filter snapshot and restores it after reload', async () => {
  store
    .getState()
    .savePreset({
      name: 'Late night',
      query: 'melodies',
      filters: { ...DEFAULT_FILTERS, lyrics: true },
      sort: 'newest',
      language: 'telugu',
    });
  store.getState().setFilters({ clean: true });
  await store.persist.rehydrate();
  expect(store.getState().presets[0]).toMatchObject({
    name: 'Late night',
    filters: { lyrics: true, clean: false },
    language: 'telugu',
  });
  const id = store.getState().presets[0].id;
  store.getState().renamePreset(id, 'My melodies');
  expect(store.getState().presets[0].name).toBe('My melodies');
  store.getState().removePreset(id);
  expect(store.getState().presets).toEqual([]);
});
it('bounds presets and ignores malformed persisted entries', async () => {
  localStorage.setItem(
    'vinax.search.workspace.v1',
    JSON.stringify({
      state: {
        presets: [
          null,
          { id: '1', name: 'Old', query: 'songs', filters: { clean: 'yes' }, sort: 'invalid' },
        ],
      },
      version: 0,
    }),
  );
  await store.persist.rehydrate();
  expect(store.getState().presets).toHaveLength(1);
  expect(store.getState().presets[0]).toMatchObject({
    sort: 'relevance',
    filters: DEFAULT_FILTERS,
  });
});
