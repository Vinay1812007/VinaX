import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { applyThemeClasses, normalizeTemplate, resolveTheme, type ResolvedTheme, type TemplateId } from '@/utils/theme';

export interface PreviewState {
  theme: ResolvedTheme;
  template: TemplateId;
  accent: string;
  reduceMotion: boolean;
}

function fromSettings(): PreviewState {
  const s = useSettingsStore.getState();
  const dark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches !== false;
  return {
    theme: resolveTheme(s.theme, dark),
    template: normalizeTemplate(s.template),
    accent: s.accent,
    reduceMotion: s.reduceMotion,
  };
}

const ACCENT_PROPS = ['--ember-300', '--ember-400', '--ember-500', '--ember-600'];

/** Puts <html> back exactly as the listener's own settings have it. */
function restore(): void {
  const root = document.documentElement;
  const s = useSettingsStore.getState();
  const own = fromSettings();
  applyThemeClasses(own.theme, root, own.template);
  root.dataset.accent = s.accent;
  ACCENT_PROPS.forEach((p) => root.style.removeProperty(p));
  if (s.accent === 'custom' && s.accentCustom) {
    void import('@/utils/accentRamp').then((m) => m.applyCustomAccent(s.accentCustom, own.theme === 'light')).catch(() => undefined);
  }
  root.classList.toggle('reduce-motion', s.reduceMotion);
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
    applyThemeClasses(state.theme, root, state.template);
    root.dataset.accent = state.accent;
    // A custom accent lives in inline properties, which would beat every named one.
    if (state.accent !== 'custom') ACCENT_PROPS.forEach((p) => root.style.removeProperty(p));
    root.classList.toggle('reduce-motion', state.reduceMotion);
  }, [state]);

  useEffect(() => restore, []);

  return [state, (patch) => setState((s) => ({ ...s, ...patch }))];
}
