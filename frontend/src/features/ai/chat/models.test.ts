// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CATALOG_PICK_KEY,
  DEFAULT_MODE_KEY,
  MAX_RECENTS,
  MODES,
  NOT_AVAILABLE,
  bestAgentChoice,
  buildModelMenu,
  catalogModelForSend,
  choiceKey,
  choiceLabel,
  contextBadge,
  isAgentChoice,
  loadInitialChoice,
  loadRecents,
  parseCatalogResponse,
  pushRecent,
  saveCatalogPick,
  saveDefaultChoice,
  saveLastChoice,
  saveRecents,
} from './models';
import type { CatalogGroup } from './types';

const GROUPS: CatalogGroup[] = [
  {
    id: 'grq',
    label: 'VinaX GRQ ALL',
    hint: 'Instant answers',
    configured: true,
    models: [
      { id: 'vendor/agentic', label: 'agentic', context: 131072, agent: true },
      { id: 'vendor/agentic-mini', label: 'agentic-mini', context: 131072, agent: true },
      { id: 'vendor/plain-8b', label: 'plain-8b', context: 8192, agent: false },
    ],
  },
  { id: 'opr', label: 'VinaX OPR ALL', hint: 'Marketplace', configured: true, models: [{ id: 'lab/big:free', label: 'big', context: 1_000_000, agent: false }] },
];

beforeEach(() => localStorage.clear());

describe('parseCatalogResponse', () => {
  it('reads groups and models, trusting only an explicit agent flag', () => {
    const groups = parseCatalogResponse({
      groups: [
        { id: 'grq', label: 'G', hint: 'h', configured: true, models: [{ id: 'a', label: 'A', context: 1024, agent: true }, { id: 'b', label: 'B', agent: 'yes' }, { id: 'a' }, null, { label: 'no id' }] },
        { id: 'mystery', models: [{ id: 'x' }] },
        { id: 'opr', configured: false },
      ],
    });
    expect(groups.map((g) => g.id)).toEqual(['grq', 'opr']);
    expect(groups[0].models).toEqual([
      { id: 'a', label: 'A', context: 1024, agent: true },
      { id: 'b', label: 'B', context: null, agent: false },
    ]);
    expect(groups[1]).toMatchObject({ configured: false, models: [] });
  });

  it('returns nothing for a malformed body', () => {
    expect(parseCatalogResponse(null)).toEqual([]);
    expect(parseCatalogResponse({})).toEqual([]);
    expect(parseCatalogResponse({ groups: 'x' })).toEqual([]);
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
  const base = { groups: GROUPS, state: 'ready' as const, query: '', agentOnly: false, recents: [] };

  it('lists every pinned engine and EVERY catalogue model, in sections', () => {
    const menu = buildModelMenu(base);
    expect(menu.map((s) => s.title)).toEqual(['Recommended', 'VinaX engines', 'VinaX GRQ ALL', 'VinaX OPR ALL']);
    expect(menu[0].rows.map((r) => r.label)).toEqual(['Auto', 'Balanced', 'Fast', 'Deep', 'Creative', 'Translate']);
    const total = menu.reduce((n, s) => n + s.rows.length, 0);
    expect(total).toBe(MODES.length + 4);
    const grq = menu[2].rows;
    expect(grq.map((r) => [r.label, r.badge, r.agent])).toEqual([
      ['agentic', '128K', true],
      ['agentic-mini', '128K', true],
      ['plain-8b', '8K', false],
    ]);
    expect(grq[0].choice).toEqual({ mode: 'scholar', model: 'vendor/agentic' });
    expect(menu[3].rows[0].choice).toEqual({ mode: 'router', model: 'lab/big:free' });
    // Option ids are unique — they become DOM ids.
    const ids = menu.flatMap((s) => s.rows.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters by every word typed, across names, hints and slugs', () => {
    const menu = buildModelMenu({ ...base, query: 'agentic mini' });
    expect(menu.flatMap((s) => s.rows.map((r) => r.label))).toEqual(['agentic-mini']);
    expect(buildModelMenu({ ...base, query: 'lyrics' }).flatMap((s) => s.rows.map((r) => r.label))).toEqual(['Creative']);
    expect(buildModelMenu({ ...base, query: 'zzzz' })).toEqual([
      { id: 'none', title: 'No matches', rows: [], note: 'No model matches “zzzz”', retry: false },
    ]);
  });

  it('shows a quiet line — never an invented list — for an empty or unconfigured catalogue', () => {
    const menu = buildModelMenu({ ...base, groups: [{ ...GROUPS[0], configured: false, models: [] }] });
    const grq = menu.find((s) => s.id === 'grq');
    const opr = menu.find((s) => s.id === 'opr');
    expect(grq).toMatchObject({ rows: [], note: NOT_AVAILABLE });
    expect(opr).toMatchObject({ rows: [], note: NOT_AVAILABLE });
  });

  it('says so while the catalogue loads, and offers a retry when it failed', () => {
    expect(buildModelMenu({ ...base, groups: [], state: 'loading' }).filter((s) => s.note === 'Loading the list…')).toHaveLength(2);
    const failed = buildModelMenu({ ...base, groups: [], state: 'failed' });
    expect(failed.filter((s) => s.retry)).toHaveLength(2);
    // The pinned engines never depend on the network.
    expect(failed[0].rows).toHaveLength(6);
  });

  it('pins recently used models at the top, newest first, at most five', () => {
    const recents = [{ mode: 'router' as const, model: 'lab/big:free' }, { mode: 'sage' as const }, { mode: 'scholar' as const, model: 'vendor/retired' }];
    const menu = buildModelMenu({ ...base, recents });
    expect(menu[0].title).toBe('Recently used');
    // A model the live catalogue no longer serves is dropped from recents.
    expect(menu[0].rows.map((r) => r.label)).toEqual(['big', 'Deep']);
    // Before the catalogue is known a saved pick still labels from its slug.
    const early = buildModelMenu({ ...base, groups: [], state: 'idle', recents });
    expect(early[0].rows.map((r) => r.label)).toEqual(['big', 'Deep', 'retired']);
    // Recents step aside while searching.
    expect(buildModelMenu({ ...base, recents, query: 'deep' })[0].title).toBe('Recommended');
  });

  it('agent mode filters the menu to agent-capable models only', () => {
    const menu = buildModelMenu({ ...base, agentOnly: true, recents: [{ mode: 'sage' }, { mode: 'scholar', model: 'vendor/agentic' }] });
    expect(menu.map((s) => s.id)).toEqual(['recent', 'grq']);
    expect(menu.flatMap((s) => s.rows).every((r) => r.agent)).toBe(true);
    const none = buildModelMenu({ ...base, agentOnly: true, groups: [GROUPS[1]] });
    expect(none).toEqual([{ id: 'no-agent', title: 'Agent models', rows: [], note: 'No agent model is available right now', retry: false }]);
  });
});

describe('agent choice', () => {
  it('picks the full-size agent model first, deterministically', () => {
    expect(bestAgentChoice(GROUPS)).toEqual({ mode: 'scholar', model: 'vendor/agentic' });
    expect(bestAgentChoice([GROUPS[1]])).toBeNull();
    expect(isAgentChoice({ mode: 'scholar', model: 'vendor/agentic-mini' }, GROUPS)).toBe(true);
    expect(isAgentChoice({ mode: 'scholar', model: 'vendor/plain-8b' }, GROUPS)).toBe(false);
    expect(isAgentChoice({ mode: 'muse' }, GROUPS)).toBe(false);
  });
});

describe('what goes on the wire', () => {
  it('sends a model only for a catalogue seat with a picked row', () => {
    expect(catalogModelForSend({ mode: 'scholar', model: 'vendor/agentic' })).toBe('vendor/agentic');
    expect(catalogModelForSend({ mode: 'scholar' })).toBeUndefined();
    expect(catalogModelForSend({ mode: 'muse', model: 'vendor/agentic' })).toBeUndefined();
  });

  it('labels a choice from its seat or its slug', () => {
    expect(choiceLabel({ mode: 'muse' })).toBe('Balanced');
    expect(choiceLabel({ mode: 'router', model: 'lab/big:free' })).toBe('big');
    expect(choiceKey({ mode: 'muse', model: 'ignored' })).toBe('muse');
  });
});

describe('persistence', () => {
  it('recents: newest first, no duplicates, capped, survive a reload', () => {
    let list = pushRecent([], { mode: 'muse' });
    list = pushRecent(list, { mode: 'sage' });
    list = pushRecent(list, { mode: 'muse' });
    expect(list).toEqual([{ mode: 'muse' }, { mode: 'sage' }]);
    for (const m of MODES.slice(0, 9)) list = pushRecent(list, { mode: m.id });
    expect(list).toHaveLength(MAX_RECENTS);
    saveRecents(list);
    expect(loadRecents()).toEqual(list);
    localStorage.setItem('vinax.aiRecentModels', '[{"mode":"nope"},{"mode":"sage","model":"bad slug!"},7]');
    expect(loadRecents()).toEqual([{ mode: 'sage' }]);
  });

  it('starts on the explicit default, else the last model used, else the everyday seat', () => {
    expect(loadInitialChoice()).toEqual({ mode: 'muse' });
    saveLastChoice({ mode: 'router', model: 'lab/big:free' });
    expect(loadInitialChoice()).toEqual({ mode: 'router', model: 'lab/big:free' });
    saveDefaultChoice({ mode: 'scholar', model: 'vendor/agentic' });
    expect(loadInitialChoice()).toEqual({ mode: 'scholar', model: 'vendor/agentic' });
    // The stored shapes are the ones the page has always used.
    expect(localStorage.getItem(DEFAULT_MODE_KEY)).toBe('scholar');
    expect(JSON.parse(localStorage.getItem(CATALOG_PICK_KEY) ?? '{}')).toEqual({ grq: 'vendor/agentic' });
    saveDefaultChoice(null);
    expect(loadInitialChoice()).toEqual({ mode: 'router', model: 'lab/big:free' });
  });

  it('maps seat ids saved by older builds to a living seat', () => {
    localStorage.setItem(DEFAULT_MODE_KEY, 'omni');
    expect(loadInitialChoice()).toEqual({ mode: 'nano' });
    localStorage.setItem(DEFAULT_MODE_KEY, 'deep');
    expect(loadInitialChoice()).toEqual({ mode: 'sage' });
  });

  it('choosing the seat itself clears its saved pick', () => {
    saveCatalogPick({ mode: 'router', model: 'lab/big:free' });
    saveCatalogPick({ mode: 'router' });
    expect(JSON.parse(localStorage.getItem(CATALOG_PICK_KEY) ?? '{}')).toEqual({});
  });
});
