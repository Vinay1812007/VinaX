import { tr } from '@/i18n';

const countFmt = new Intl.NumberFormat('en');

/** "5,273 results": the catalogue's own count for a results tab; null when it sent none. */
export function resultCountLine(total: number | null): string | null {
  if (!total || total < 1) return null;
  return total === 1 ? tr('1 result') : tr('{n} results', { n: countFmt.format(total) });
}
