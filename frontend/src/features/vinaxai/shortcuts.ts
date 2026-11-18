/**
 * VinaX AI — keyboard shortcuts, the ones Claude's chat has (⌘ on a Mac,
 * Ctrl elsewhere). `matchShortcut` names the shortcut a key press is, if
 * any; ChatView acts on it. The app's own player shortcuts (Space, arrows,
 * letters) ignore every modifier combination, so these never collide; the
 * app's command palette owns Mod+K, so chat search is Mod+Shift+K.
 */
export type ShortcutId = 'new-chat' | 'toggle-sidebar' | 'search-chats' | 'focus-composer' | 'copy-last' | 'settings' | 'help';

export interface Shortcut {
  id: ShortcutId;
  label: string;
  /** The keys as shown: 'Mod' is ⌘ or Ctrl. */
  keys: string[];
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'new-chat', label: 'New chat', keys: ['Mod', 'Shift', 'O'] },
  { id: 'search-chats', label: 'Search chats', keys: ['Mod', 'Shift', 'K'] },
  { id: 'toggle-sidebar', label: 'Show or hide the sidebar', keys: ['Mod', 'Shift', 'S'] },
  { id: 'focus-composer', label: 'Go to the message box', keys: ['Shift', 'Esc'] },
  { id: 'copy-last', label: 'Copy the last reply', keys: ['Mod', 'Shift', 'C'] },
  { id: 'settings', label: 'Open settings', keys: ['Mod', ','] },
  { id: 'help', label: 'Show these shortcuts', keys: ['Mod', '/'] },
];

export const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** A key's name as it is printed on the keycap. */
export function keyLabel(key: string, mac = isMac()): string {
  switch (key) {
    case 'Mod': return mac ? '⌘' : 'Ctrl';
    case 'Shift': return mac ? '⇧' : 'Shift';
    case 'Esc': return 'Esc';
    default: return key;
  }
}

interface KeyLike { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }

/** Which shortcut this key press is, or null. The modifier is ⌘ on a Mac and Ctrl elsewhere, never both ways. */
export function matchShortcut(e: KeyLike, mac = isMac()): ShortcutId | null {
  if (e.altKey) return null;
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (!mod) return e.shiftKey && key === 'Escape' ? 'focus-composer' : null;
  if (e.shiftKey) {
    if (key === 'o') return 'new-chat';
    if (key === 's') return 'toggle-sidebar';
    if (key === 'c') return 'copy-last';
    if (key === 'k') return 'search-chats';
    return null;
  }
  if (key === ',') return 'settings';
  if (key === '/') return 'help';
  return null;
}
