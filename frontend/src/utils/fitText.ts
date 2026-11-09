/**
 * Text that fits a canvas width, cut between whole characters. Slicing code
 * units broke Telugu and Hindi titles mid-letter (a conjunct or a vowel sign
 * split from its base); these measure and cut by grapheme instead. Shared by
 * the lyric, song and now-playing cards.
 */

/** Whole characters as the reader sees them — an Indic conjunct or a vowel sign is never split. */
export function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: 'grapheme' }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  return Array.from(s);
}

/**
 * The longest start of `text` that fits `maxW` on this canvas, with an
 * ellipsis when it had to be cut.
 */
export function fitText(x: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (x.measureText(text).width <= maxW) return text;
  const g = graphemes(text);
  let lo = 0;
  let hi = g.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (x.measureText(g.slice(0, mid).join('') + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return g.slice(0, lo).join('').trimEnd() + '…';
}
