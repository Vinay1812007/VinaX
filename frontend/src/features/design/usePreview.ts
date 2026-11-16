import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { applyThemeClasses, normalizeTemplate, resolveTheme, type ResolvedTheme, type TemplateId } from '@/utils/theme';

export interface PreviewState {
  theme: ResolvedTheme;
  template: TemplateId;
  reduceMotion: boolean;
}

function fromSettings(): PreviewState {
  const s = useSettingsStore.getState();
  const dark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches !== false;
  return { theme: resolveTheme(s.theme, dark), template: normalizeTemplate(s.template), reduceMotion: s.reduceMotion };
}

/** Puts <html> back exactly as the listener's own settings have it. */
function restore(): void {
  const root = document.documentElement;
  const own = fromSettings();
  applyThemeClasses(root, own.template, own.theme);
  root.classList.toggle('reduce-motion', own.reduceMotion);
}

/**
 * The style guide's preview controls. They change only what <html> looks
 * like while /design is open — never the listener's saved settings — and
 * leaving the page puts everything back.
 */
export function usePreview(): [PreviewState, (patch: Partial<PreviewState>) => void] {
  const [state, setState] = useState<PreviewState>(fromSettings);

  useEffect(() => {
    const root = document.documentElement;
    applyThemeClasses(root, state.template, state.theme);
    root.classList.toggle('reduce-motion', state.reduceMotion);
  }, [state]);

  useEffect(() => restore, []);

  return [state, (patch) => setState((s) => ({ ...s, ...patch }))];
}
