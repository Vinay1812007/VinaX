const countFmt = new Intl.NumberFormat('en');

/** "5,273 results": the catalogue's own count for a results tab; null when it sent none. */
export function resultCountLine(total: number | null): string | null {
  if (!total || total < 1) return null;
  return `${countFmt.format(total)} result${total === 1 ? '' : 's'}`;
}
