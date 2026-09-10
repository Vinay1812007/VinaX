/**
 * Display width, not string length.
 *
 * `"é".length` is 2 when it is e + combining acute; a flag emoji is 4 UTF-16
 * units and 2 columns; a CJK ideograph is 1 unit and 2 columns. Cursor
 * arithmetic done in UTF-16 offsets therefore drifts, and the prompt visibly
 * corrupts the moment somebody types an emoji.
 *
 * So the editor works in GRAPHEMES (what a user calls "a character") and
 * measures in COLUMNS (what the terminal draws).
 */

interface SegmenterLike {
  segment(s: string): Iterable<{ segment: string }>;
}

/** Split text into user-perceived characters. */
export function graphemes(text: string): string[] {
  // Intl.Segmenter is the correct answer and is present in Node 22. The
  // fallback only has to avoid the catastrophic case — splitting a surrogate
  // pair — which [...text] already handles.
  const Seg = (Intl as unknown as {
    Segmenter?: new (l?: string, o?: { granularity: string }) => SegmenterLike;
  }).Segmenter;
  if (Seg) {
    const out: string[] = [];
    for (const g of new Seg(undefined, { granularity: 'grapheme' }).segment(text)) out.push(g.segment);
    return out;
  }
  return [...text];
}

/** Zero-width: combining marks, variation selectors, joiners. */
function isZeroWidth(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    cp === 0xfeff
  );
}

/** Double-width: CJK, Hangul, and the emoji ranges terminals draw wide. */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Columns one grapheme occupies. */
export function graphemeWidth(g: string): number {
  const first = g.codePointAt(0);
  if (first === undefined) return 0;
  if (first < 0x20 || first === 0x7f) return 0; // control characters draw nothing
  if (isZeroWidth(first)) return 0;
  // A cluster's width is its base character's; the marks that follow add none.
  return isWide(first) ? 2 : 1;
}

/** Columns a string occupies when drawn. */
export function displayWidth(text: string): number {
  let w = 0;
  for (const g of graphemes(text)) w += graphemeWidth(g);
  return w;
}

/** Truncate to a column budget, appending an ellipsis when it does not fit. */
export function truncateToWidth(text: string, max: number, ellipsis = '…'): string {
  if (max <= 0) return '';
  if (displayWidth(text) <= max) return text;
  const budget = max - displayWidth(ellipsis);
  let out = '';
  let w = 0;
  for (const g of graphemes(text)) {
    const gw = graphemeWidth(g);
    if (w + gw > budget) break;
    out += g;
    w += gw;
  }
  return out + ellipsis;
}
