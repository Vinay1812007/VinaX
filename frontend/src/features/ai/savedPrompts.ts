/**
 * v5.16.0 — the listener's own prompt library, on this device only.
 * Reachable from the welcome screen, the "/prompts" command and the composer.
 */
export interface SavedPrompt {
  id: string;
  title: string;
  text: string;
  createdAt: number;
}

const KEY = 'vinax.aiPrompts';
const MAX = 60;

export function loadPrompts(): SavedPrompt[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as SavedPrompt[]).filter((p) => p && typeof p.text === 'string') : [];
  } catch {
    return [];
  }
}

function save(list: SavedPrompt[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage full or blocked */
  }
}

export function addPrompt(text: string, title?: string): SavedPrompt[] {
  const t = text.trim();
  if (!t) return loadPrompts();
  const p: SavedPrompt = { id: Math.random().toString(36).slice(2, 10), title: (title ?? t).trim().slice(0, 60), text: t.slice(0, 2000), createdAt: Date.now() };
  const list = [p, ...loadPrompts().filter((x) => x.text !== t)];
  save(list);
  return list;
}

export function removePrompt(id: string): SavedPrompt[] {
  const list = loadPrompts().filter((p) => p.id !== id);
  save(list);
  return list;
}
