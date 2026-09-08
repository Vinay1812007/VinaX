/**
 * v5.17.0 — empty-box search tips: one helper line and three example queries
 * shaped around the listener's pinned languages.
 */
import { languageLabel } from '@/constants/languages';

export const SEARCH_TIP_LINE = 'Try: a lyric line · an artist + film · a mood in your language';

/** Three example searches. With pinned languages, each chip takes the next
 *  language in turn (wrapping around); with none, they stay language-free. */
export function exampleQueries(pinnedLanguages: readonly string[]): string[] {
  const langs = pinnedLanguages.map((l) => languageLabel(l)).filter(Boolean);
  const at = (i: number): string => (langs.length ? langs[i % langs.length] : '');
  const join = (...parts: string[]) => parts.filter(Boolean).join(' ');
  return [
    join(at(0), 'love songs'),
    join(at(1), '90s hits'),
    join('rainy evening', at(2), 'melodies'),
  ];
}
