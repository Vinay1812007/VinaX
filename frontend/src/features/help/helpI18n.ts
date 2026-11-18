import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import type { UiLang } from '@/i18n';
import type { HelpTourStep, HelpTranslation, HelpUiKey } from '@/i18n/help/types';
import type { FaqEntry, Guide } from './helpContent';

/**
 * Help, the FAQ and the guided tours in the app language. The Telugu, Hindi,
 * Tamil, Kannada and Malayalam text is a lazy chunk per language (src/i18n/help), fetched the
 * first time Help or a tour opens in that language and kept for the session;
 * it is never part of the first load or of the main dictionaries. Anything a
 * translation lacks shows in English.
 */
// Partial: a new app language with no Help file yet simply reads Help in English.
const LOADERS: Partial<Record<Exclude<UiLang, 'en'>, () => Promise<{ default: HelpTranslation }>>> = {
  te: () => import('@/i18n/help/te'),
  hi: () => import('@/i18n/help/hi'),
  ta: () => import('@/i18n/help/ta'),
  kn: () => import('@/i18n/help/kn'),
  ml: () => import('@/i18n/help/ml'),
};

const cache = new Map<UiLang, HelpTranslation>();
const pending = new Map<UiLang, Promise<HelpTranslation | null>>();

/** Fetch a language's Help text (once). Null for English, or when the chunk cannot load. */
export function loadHelpTranslation(lang: UiLang): Promise<HelpTranslation | null> {
  if (lang === 'en') return Promise.resolve(null);
  const hit = cache.get(lang);
  if (hit) return Promise.resolve(hit);
  const load = LOADERS[lang];
  if (!load) return Promise.resolve(null);
  let p = pending.get(lang);
  if (!p) {
    p = load()
      .then((m) => { cache.set(lang, m.default); return m.default; })
      .catch(() => null)
      .finally(() => pending.delete(lang));
    pending.set(lang, p);
  }
  return p;
}

/** The Help text for the chosen app language: null in English and until the chunk lands (English shows meanwhile). */
export function useHelpTranslation(): HelpTranslation | null {
  const lang = useSettingsStore((s) => s.uiLanguage);
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (lang === 'en' || cache.has(lang)) return;
    let live = true;
    void loadHelpTranslation(lang).then(() => { if (live) setLoaded((n) => n + 1); });
    return () => { live = false; };
  }, [lang]);
  return lang === 'en' ? null : cache.get(lang) ?? null;
}

/** A translator for the Help page's and the tour card's own words; `{name}` placeholders are filled from `vars`. */
export function helpUi(tr: HelpTranslation | null): (key: HelpUiKey, vars?: Record<string, string | number>) => string {
  return (key, vars) => {
    let s: string = tr?.ui[key] || key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}

/** A guide in the app language; English when it has no translation or its steps no longer line up. */
export function localGuide(g: Guide, tr: HelpTranslation | null): Guide {
  const t = tr?.guides[g.id];
  const group = tr?.groups[g.group] || g.group;
  if (!t || t.steps.length !== g.steps.length) return group === g.group ? g : { ...g, group };
  return { ...g, group, title: t.title || g.title, steps: g.steps.map((s, i) => t.steps[i] || s) };
}

export function localFaq(f: FaqEntry, tr: HelpTranslation | null): FaqEntry {
  const t = tr?.faq[f.id];
  return t ? { ...f, q: t.q || f.q, a: t.a || f.a } : f;
}

export function localShortcut(description: string, tr: HelpTranslation | null): string {
  return tr?.shortcuts[description] || description;
}

interface TourLike { id: string; title: string; blurb: string; steps: Array<HelpTourStep> }

/** A tour's title, blurb and "cannot run yet" line in the app language. */
export function localTour(t: TourLike, tr: HelpTranslation | null, needs?: string | null): { title: string; blurb: string; needs: string | null } {
  const l = tr?.tutorials[t.id];
  return { title: l?.title || t.title, blurb: l?.blurb || t.blurb, needs: needs ? l?.needs || needs : null };
}

/**
 * One tour step's words in the app language. Only the text is swapped: the
 * step's target, route and action stay the English definition's, so a tour
 * finds the same controls in every language.
 */
export function localStep(t: TourLike, index: number, tr: HelpTranslation | null): HelpTourStep {
  const en = t.steps[index];
  const l = tr?.tutorials[t.id];
  const s = l && l.steps.length === t.steps.length ? l.steps[index] : undefined;
  if (!en) return { title: '', body: '' };
  if (!s) return { title: en.title, body: en.body, tip: en.tip };
  return { title: s.title || en.title, body: s.body || en.body, tip: en.tip ? s.tip || en.tip : undefined };
}
