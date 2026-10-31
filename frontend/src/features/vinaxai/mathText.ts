/**
 * VinaX AI — keeps prices from turning into maths. remark-math reads any
 * `$…$` pair as inline maths, so "$5 and $10" would render "5 and " as a
 * formula. Like Pandoc, a single-dollar span only counts as maths when the
 * text right inside both dollars is not a space and the closing dollar is
 * not followed by a digit; other dollars are escaped. Code (fenced or
 * inline) is left untouched, and `$$…$$` display maths is not affected.
 */
export function escapeCurrency(md: string): string {
  if (!md.includes('$')) return md;
  const out: string[] = [];
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    out.push(inFence ? line : escapeLine(line));
  }
  return out.join('\n');
}

function escapeLine(line: string): string {
  // Split out inline code so dollars inside it are never touched.
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 === 1 ? part : escapeSegment(part)))
    .join('');
}

function escapeSegment(seg: string): string {
  let res = '';
  let i = 0;
  while (i < seg.length) {
    const ch = seg[i];
    if (ch === '\\') { res += seg.slice(i, i + 2); i += 2; continue; }
    if (ch !== '$') { res += ch; i += 1; continue; }
    if (seg[i + 1] === '$') {
      // Display maths: copy the $$…$$ run as it is.
      const end = seg.indexOf('$$', i + 2);
      const stop = end < 0 ? seg.length : end + 2;
      res += seg.slice(i, stop);
      i = stop;
      continue;
    }
    const close = findClose(seg, i + 1);
    const inner = close < 0 ? '' : seg.slice(i + 1, close);
    const isMath = close > 0 && inner.length > 0 && !/^\s/.test(inner) && !/\s$/.test(inner) && !/\d/.test(seg[close + 1] ?? '');
    if (isMath) {
      res += seg.slice(i, close + 1);
      i = close + 1;
    } else {
      res += '\\$';
      i += 1;
    }
  }
  return res;
}

function findClose(seg: string, from: number): number {
  for (let j = from; j < seg.length; j++) {
    if (seg[j] === '\\') { j += 1; continue; }
    if (seg[j] === '$') return seg[j + 1] === '$' ? -1 : j;
  }
  return -1;
}
