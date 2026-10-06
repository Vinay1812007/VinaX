// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MODE_KEY,
  LAST_MODEL_KEY,
  MAX_RECENTS,
  NOT_AVAILABLE,
  RECENT_MODELS_KEY,
  buildModelMenu,
  choiceKey,
  choiceLabel,
  contextBadge,
  loadDefaultChoice,
  loadInitialChoice,
  loadRecents,
  parseCatalogResponse,
  pushRecent,
  saveDefaultChoice,
  saveLastChoice,
  saveRecents,
} from './models';
import type { ModelChoice, Provider } from './types';

/** A fixture in the GET /api/aimodels shape, already parsed. */
const PROVIDERS: Provider[] = [
  {
    id: 'nvidia',
    label: 'NVIDIA',
    configured: true,
    models: [
      { id: 'lab/alpha-70b-instruct', name: 'Alpha 70B Instruct', maker: 'Lab One', context: 131072, vision: false },
      { id: 'lab/alpha-11b-vision', name: 'Alpha 11B Vision', maker: 'Lab One', context: 8192, vision: true },
    ],
  },
  { id: 'openrouter', label: 'OpenRouter', configured: true, models: [{ id: 'maker/big:free', name: 'Big Model', maker: 'Maker Two', context: 1_000_000, vision: false }] },
  { id: 'groq', label: 'Groq', configured: true, models: [{ id: 'small-8b', name: 'Small 8B', maker: null, context: null, vision: false }] },
  { id: 'gemini', label: 'Gemini', configured: false, models: [] },
];
const pick = (provider: Provider['id'], model: string, name?: string): ModelChoice => ({ mode: 'model', provider, model, ...(name ? { name } : {}) });

beforeEach(() => localStorage.clear());

describe('parseCatalogResponse', () => {
  it('reads the four providers in menu order, keeping original names and dropping what it cannot trust', () => {
    const providers = parseCatalogResponse({
      fetchedAt: '2026-10-06T00:00:00Z',
      providers: [
        { id: 'groq', label: 'Groq', configured: true, models: [{ id: 'small-8b', name: 'Small 8B', maker: null, context: 8192, vision: false }] },
        {
          id: 'nvidia',
          configured: true,
          models: [
            { id: 'lab/a', name: '  Model A  ', maker: 'Lab', context: 1024, vision: true },
            { id: 'lab/b' },
            { id: 'lab/a', name: 'duplicate' },
            { id: 'bad slug!', name: 'x' },
            null,
            { name: 'no id' },
          ],
        },
        { id: 'mystery', configured: true, models: [{ id: 'x' }] },
      ],
    });
    expect(providers.map((p) => p.id)).toEqual(['nvidia', 'openrouter', 'groq', 'gemini']);
    expect(providers[0].models).toEqual([
      { id: 'lab/a', name: 'Model A', maker: 'Lab', context: 1024, vision: true },
      { id: 'lab/b', name: 'b', maker: null, context: null, vision: false },
    ]);
    expect(providers[0].label).toBe('NVIDIA');
    // A provider the server left out reads as not configured, never invented.
    expect(providers[1]).toEqual({ id: 'openrouter', label: 'OpenRouter', configured: false, models: [], media: [], tools: [] });
    expect(providers[2].models[0]).toMatchObject({ name: 'Small 8B', context: 8192 });
  });

  it('returns nothing for a malformed body or an older server’s groups', () => {
    expect(parseCatalogResponse(null)).toEqual([]);
    expect(parseCatalogResponse({})).toEqual([]);
    expect(parseCatalogResponse({ providers: 'x' })).toEqual([]);
    expect(parseCatalogResponse({ groups: [{ id: 'grq', models: [{ id: 'a' }] }] })).toEqual([]);
  });
});

describe('contextBadge', () => {
  it('formats context windows the way people say them', () => {
    expect(contextBadge(131072)).toBe('128K');
    expect(contextBadge(128000)).toBe('128K');
    expect(contextBadge(8192)).toBe('8K');
    expect(contextBadge(1_000_000)).toBe('1M');
    expect(contextBadge(1_048_576)).toBe('1M');
    expect(contextBadge(null)).toBeNull();
    expect(contextBadge(0)).toBeNull();
  });
});

describe('buildModelMenu', () => {
  const base = { providers: PROVIDERS, state: 'ready' as const, query: '', recents: [] };

  it('puts Auto first, then one section per provider listing EVERY model under its original name', () => {
    const menu = buildModelMenu(base);
    expect(menu.map((s) => s.id)).toEqual(['auto', 'nvidia', 'openrouter', 'groq', 'gemini']);
    expect(menu[0]).toMatchObject({ title: '', label: 'Auto', rows: [{ choice: { mode: 'auto' }, label: 'Auto', hint: 'Picks the best model for each question' }] });
    expect(menu.slice(1).map((s) => [s.title, s.provider])).toEqual([
      ['NVIDIA', 'nvidia'],
      ['OpenRouter', 'openrouter'],
      ['Groq', 'groq'],
      ['Gemini', 'gemini'],
    ]);
    expect(menu[1].rows.map((r) => [r.label, r.hint, r.vision])).toEqual([
      ['Alpha 70B Instruct', 'Lab One · 128K context', false],
      ['Alpha 11B Vision', 'Lab One · 8K context', true],
    ]);
    expect(menu[1].rows[0].choice).toEqual(pick('nvidia', 'lab/alpha-70b-instruct', 'Alpha 70B Instruct'));
    expect(menu[2].rows[0].hint).toBe('Maker Two · 1M context');
    // No maker and no context: no secondary line rather than an empty one.
    expect(menu[3].rows[0].hint).toBe('');
    // Option ids are unique — they become DOM ids.
    const ids = menu.flatMap((s) => s.rows.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows one quiet line — never an invented list — for a provider without a key or without models', () => {
    const menu = buildModelMenu({ ...base, providers: [{ ...PROVIDERS[0], configured: false }, { ...PROVIDERS[1], models: [] }, PROVIDERS[2], PROVIDERS[3]] });
    for (const id of ['nvidia', 'openrouter', 'gemini']) expect(menu.find((s) => s.id === id)).toMatchObject({ rows: [], note: NOT_AVAILABLE });
    expect(menu.find((s) => s.id === 'groq')?.rows).toHaveLength(1);
  });

  it('filters by every word typed, across name, maker, slug and provider', () => {
    const labels = (query: string): string[] => buildModelMenu({ ...base, query }).flatMap((s) => s.rows.map((r) => r.label));
    expect(labels('vision')).toEqual(['Alpha 11B Vision']);
    expect(labels('maker two')).toEqual(['Big Model']);
    expect(labels('small-8b')).toEqual(['Small 8B']);
    expect(labels('openrouter')).toEqual(['Big Model']);
    expect(labels('nvidia 70b')).toEqual(['Alpha 70B Instruct']);
    expect(labels('best')).toEqual(['Auto']);
    expect(buildModelMenu({ ...base, query: 'zzzz' })).toEqual([
      { id: 'none', title: 'No matches', label: 'No matches', provider: null, rows: [], note: 'No model matches “zzzz”', retry: false },
    ]);
  });

  it('says so while the list loads, and offers a retry when it failed — Auto never depends on it', () => {
    expect(buildModelMenu({ ...base, providers: [], state: 'loading' }).filter((s) => s.note === 'Loading the list…')).toHaveLength(4);
    const failed = buildModelMenu({ ...base, providers: [], state: 'failed' });
    expect(failed.filter((s) => s.retry)).toHaveLength(4);
    expect(failed[0].rows.map((r) => r.label)).toEqual(['Auto']);
  });

  it('lists recently used models under Auto, with their provider, newest first', () => {
    const recents = [pick('openrouter', 'maker/big:free', 'Big Model'), pick('groq', 'retired-model', 'Retired One'), pick('nvidia', 'lab/alpha-11b-vision')];
    const menu = buildModelMenu({ ...base, recents });
    expect(menu[1].title).toBe('Recently used');
    // A model the live list no longer serves is dropped from recents.
    expect(menu[1].rows.map((r) => [r.label, r.provider])).toEqual([
      ['Big Model', 'openrouter'],
      ['Alpha 11B Vision', 'nvidia'],
    ]);
    expect(menu[1].rows[0].hint).toBe('OpenRouter · Maker Two · 1M context');
    // Before the list is known a saved pick still labels from its saved name (or slug).
    const early = buildModelMenu({ ...base, providers: [], state: 'idle', recents });
    expect(early[1].rows.map((r) => r.label)).toEqual(['Big Model', 'Retired One', 'alpha-11b-vision']);
    // Recents step aside while searching.
    expect(buildModelMenu({ ...base, recents, query: 'big' }).map((s) => s.id)).toEqual(['openrouter']);
  });
});

describe('choices', () => {
  it('labels a choice by the live original name, else the saved name, else the slug', () => {
    expect(choiceLabel({ mode: 'auto' })).toBe('Auto');
    expect(choiceLabel(pick('openrouter', 'maker/big:free', 'Old Name'), PROVIDERS)).toBe('Big Model');
    expect(choiceLabel(pick('openrouter', 'maker/big:free', 'Old Name'))).toBe('Old Name');
    expect(choiceLabel(pick('openrouter', 'maker/big:free'))).toBe('big');
    expect(choiceKey(pick('groq', 'small-8b', 'ignored'))).toBe('groq:small-8b');
    expect(choiceKey({ mode: 'auto' })).toBe('auto');
  });
});

describe('persistence', () => {
  it('recents: newest first, no duplicates, never Auto, capped, survive a reload', () => {
    let list = pushRecent([], pick('groq', 'a'));
    list = pushRecent(list, pick('groq', 'b'));
    list = pushRecent(list, pick('groq', 'a'));
    list = pushRecent(list, { mode: 'auto' });
    expect(list).toEqual([pick('groq', 'a'), pick('groq', 'b')]);
    for (let i = 0; i < 9; i++) list = pushRecent(list, pick('nvidia', `m${i}`));
    expect(list).toHaveLength(MAX_RECENTS);
    saveRecents(list);
    expect(loadRecents()).toEqual(list);
  });

  it('starts on the explicit default, else the last model used, else Auto', () => {
    expect(loadInitialChoice()).toEqual({ mode: 'auto' });
    saveLastChoice(pick('openrouter', 'maker/big:free', 'Big Model'));
    expect(loadInitialChoice()).toEqual(pick('openrouter', 'maker/big:free', 'Big Model'));
    saveDefaultChoice(pick('groq', 'small-8b'));
    expect(loadInitialChoice()).toEqual(pick('groq', 'small-8b'));
    saveDefaultChoice({ mode: 'auto' });
    expect(localStorage.getItem(DEFAULT_MODE_KEY)).toBe('auto');
    expect(loadInitialChoice()).toEqual({ mode: 'auto' });
    saveDefaultChoice(null);
    expect(loadInitialChoice()).toEqual(pick('openrouter', 'maker/big:free', 'Big Model'));
  });

  it('migrates a stale stored pick — an old seat or a grq/opr catalogue pick — to Auto, quietly', () => {
    localStorage.setItem(LAST_MODEL_KEY, JSON.stringify({ mode: 'router', model: 'lab/big:free' }));
    expect(loadInitialChoice()).toEqual({ mode: 'auto' });
    expect(localStorage.getItem(LAST_MODEL_KEY)).toBeNull();

    localStorage.setItem(LAST_MODEL_KEY, JSON.stringify({ mode: 'maestro' }));
    expect(loadInitialChoice()).toEqual({ mode: 'auto' });

    for (const seat of ['muse', 'scholar', 'translator', 'deep']) {
      localStorage.setItem(DEFAULT_MODE_KEY, seat);
      expect(loadDefaultChoice()).toBeNull();
      expect(localStorage.getItem(DEFAULT_MODE_KEY)).toBeNull();
    }
    // An older build's explicit "auto" default is still Auto.
    localStorage.setItem(DEFAULT_MODE_KEY, 'auto');
    expect(loadDefaultChoice()).toEqual({ mode: 'auto' });

    localStorage.setItem(
      RECENT_MODELS_KEY,
      JSON.stringify([{ mode: 'sage' }, { mode: 'scholar', model: 'vendor/agentic' }, pick('groq', 'small-8b'), { mode: 'model', provider: 'grq', model: 'x' }, pick('nvidia', 'bad slug!'), 7]),
    );
    expect(loadRecents()).toEqual([pick('groq', 'small-8b')]);
    expect(JSON.parse(localStorage.getItem(RECENT_MODELS_KEY) ?? '[]')).toEqual([pick('groq', 'small-8b')]);
  });
});
