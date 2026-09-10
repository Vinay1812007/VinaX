/**
 * The interactive selectors behind /engine, /model, /permissions and /resume.
 *
 * Each one is the same generic menu with different items, so they all answer
 * to the same keys. The direct forms (`/engine fast`) keep working — these
 * open only when the command arrives with no argument, which is exactly when
 * a user is asking "what are my options?".
 */
import type { ApprovalMode } from '../config/args.js';
import type { MenuItem } from './menu.js';
import type { TerminalApp } from './app.js';
import type { Meta, MetaEngine, CatalogGroup } from '../api/client.js';

export const APPROVAL_ITEMS: Array<MenuItem<ApprovalMode>> = [
  {
    id: 'ask',
    label: 'Ask',
    description: 'Reads run freely; everything else is confirmed',
    value: 'ask',
  },
  {
    id: 'auto-edit',
    label: 'Auto edit',
    description: 'Edits and routine commands run unattended',
    value: 'auto-edit',
  },
  {
    id: 'full-auto',
    label: 'Full auto',
    description: 'Routine project work runs; high-impact actions still ask',
    value: 'full-auto',
  },
];

export async function pickApprovalMode(app: TerminalApp, current: ApprovalMode): Promise<ApprovalMode | null> {
  return app.choose({
    title: 'Permission mode',
    items: APPROVAL_ITEMS.map((i) => (i.value === current ? { ...i, label: `${i.label}  (current)` } : i)),
    hint: '↑↓ navigate · Enter apply · Esc cancel',
  });
}

/** Engines, from live service metadata — never a hard-coded list. */
export function engineItems(meta: Meta, current: string): Array<MenuItem<string>> {
  return meta.engines.map((e: MetaEngine) => ({
    id: e.id,
    label: e.id === current ? `${e.id}  (current)` : e.id,
    description: e.available
      ? `${e.hint || e.label}${e.acceptsModel ? ' · model selectable' : ''}`
      : `${e.hint || e.label} · not configured`,
    disabled: !e.available,
    keywords: e.label,
    value: e.id,
  }));
}

export async function pickEngine(app: TerminalApp, meta: Meta, current: string): Promise<string | null> {
  return app.choose({
    title: 'Choose VinaX engine',
    items: engineItems(meta, current),
    hint: '↑↓ navigate · Enter select · type to filter · Esc cancel',
    filterable: true,
    maxVisible: 10,
  });
}

/** Models from the live catalogue for a model-selectable engine. */
export function modelItems(groups: CatalogGroup[], catalog: string | undefined, current: string | null): Array<MenuItem<string>> {
  const items: Array<MenuItem<string>> = [];
  for (const group of groups) {
    if (catalog && group.id !== catalog) continue;
    if (!group.configured) continue;
    for (const m of group.models) {
      items.push({
        id: m.id,
        label: m.id === current ? `${m.label}  (current)` : m.label,
        description: `${m.id}${m.context ? ` · ${m.context.toLocaleString('en-US')} ctx` : ''}`,
        keywords: m.id,
        value: m.id,
      });
    }
  }
  return items;
}

export async function pickModel(
  app: TerminalApp,
  groups: CatalogGroup[],
  catalog: string | undefined,
  current: string | null,
): Promise<string | null> {
  const items = modelItems(groups, catalog, current);
  if (!items.length) return null;
  return app.choose({
    title: 'Choose a model',
    items,
    hint: '↑↓ navigate · Enter select · type to filter · Esc cancel',
    filterable: true,
    maxVisible: 12,
  });
}

export interface SessionRow {
  id: string;
  title: string;
  workspace: string;
  branch: string;
  messages: number;
  filesChanged: number;
  updatedAt: number;
}

export function sessionItems(rows: SessionRow[]): Array<MenuItem<string>> {
  return rows.slice(0, 40).map((r) => ({
    id: r.id,
    label: r.title || '(no messages)',
    description: `${new Date(r.updatedAt).toISOString().replace('T', ' ').slice(0, 16)} · ${r.messages} messages · ${r.filesChanged} files`,
    keywords: `${r.id} ${r.workspace} ${r.branch}`,
    value: r.id,
  }));
}

export async function pickSession(app: TerminalApp, rows: SessionRow[]): Promise<string | null> {
  const items = sessionItems(rows);
  if (!items.length) return null;
  return app.choose({
    title: 'Resume a session',
    items,
    hint: '↑↓ navigate · Enter resume · type to filter · Esc cancel',
    filterable: true,
    maxVisible: 10,
  });
}
