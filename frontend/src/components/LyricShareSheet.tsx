import { useState } from 'react';
import type { Song } from '@/types';
import { cn } from '@/utils/cn';
import { toast } from '@/store/toastStore';
import { shareOrSaveImage } from '@/utils/shareImage';
import { Sheet, SheetHeader } from './Sheet';

const MAX = 6;
const FONT = 'Manrope, system-ui, sans-serif';

/** Whole characters as the reader sees them — an Indic conjunct or a vowel sign is never split. */
function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: 'grapheme' }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  return Array.from(s);
}

/**
 * The longest start of `text` that fits `maxW` on this canvas, with an
 * ellipsis when it had to be cut. Measured, and cut between whole
 * characters — slicing code units broke Telugu and Hindi titles mid-letter.
 */
function fitText(x: CanvasRenderingContext2D, text: string, maxW: number): string {
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

/** The share card. Canvas art is the standing exception to "no raw colours": these are Encore's charcoal, Iris and Lagoon. */
async function renderLyricCard(lines: string[], song: Song): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1080;
  const x = c.getContext('2d');
  if (!x) throw new Error('no canvas');
  // The brand face, if the page has it; the card falls back to the system face otherwise.
  try {
    await document.fonts?.load(`700 64px ${FONT}`);
  } catch {
    /* system font it is */
  }

  const bg = x.createLinearGradient(0, 0, 0, 1080);
  bg.addColorStop(0, '#1b141f');
  bg.addColorStop(1, '#0d090f');
  x.fillStyle = bg;
  x.fillRect(0, 0, 1080, 1080);
  const glow = x.createRadialGradient(220, 200, 0, 220, 200, 680);
  glow.addColorStop(0, 'rgba(255,164,46,0.34)');
  glow.addColorStop(1, 'rgba(255,164,46,0)');
  x.fillStyle = glow;
  x.fillRect(0, 0, 1080, 1080);
  const glow2 = x.createRadialGradient(940, 980, 0, 940, 980, 520);
  glow2.addColorStop(0, 'rgba(255,99,132,0.16)');
  glow2.addColorStop(1, 'rgba(255,99,132,0)');
  x.fillStyle = glow2;
  x.fillRect(0, 0, 1080, 1080);

  x.fillStyle = 'rgba(255,192,102,0.6)';
  x.font = `800 200px ${FONT}`;
  x.fillText('“', 80, 290);

  const fontSize = lines.length <= 2 ? 76 : lines.length <= 4 ? 62 : 50;
  x.font = `700 ${fontSize}px ${FONT}`;
  const maxW = 900;
  const lineH = fontSize * 1.34;
  const wrapped: string[] = [];
  for (const ln of lines) {
    const words = ln.split(' ');
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (x.measureText(test).width > maxW && cur) {
        wrapped.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) wrapped.push(cur);
  }
  const blockH = wrapped.length * lineH;
  let y = Math.max(360, (1080 - blockH) / 2);
  x.fillStyle = '#ffffff';
  for (const w of wrapped) {
    x.fillText(w, 90, y);
    y += lineH;
  }

  x.fillStyle = '#eae3e2';
  x.font = `700 40px ${FONT}`;
  x.fillText(fitText(x, song.title, 760), 90, 952);
  x.fillStyle = '#b6abb8';
  x.font = `500 34px ${FONT}`;
  x.fillText(fitText(x, song.subtitle, 760), 90, 1000);
  x.fillStyle = '#ffc066';
  x.font = `800 30px ${FONT}`;
  x.fillText('VinaX', 920, 1000);

  return await new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'),
  );
}

export function LyricShareSheet({ lines, song, onClose }: { lines: string[]; song: Song; onClose: () => void }) {
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (i: number) =>
    setSel((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < MAX ? [...p, i] : p));

  const create = async () => {
    if (!sel.length) return;
    setBusy(true);
    try {
      const chosen = sel.slice().sort((a, b) => a - b).map((i) => lines[i]);
      const blob = await renderLyricCard(chosen, song);
      await shareOrSaveImage(blob, 'vinax-lyrics.png', `${song.title} — lyrics`);
    } catch {
      toast('Could not create the image');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} labelledBy="lyric-share-title" layout="column" maxHeight="medium" backdropClassName="bg-ink-950/80 backdrop-blur-sm">
      <SheetHeader id="lyric-share-title" title="Share lyrics" subtitle={`Tap up to ${MAX} lines, then create your card.`} onClose={onClose} />
      <div className="overflow-y-auto flex-1 -mx-1 px-1 mt-3 space-y-1" role="group" aria-label="Lines to share">
        {lines.map((line, i) => {
          const on = sel.includes(i);
          return (
            <button
              key={`${i}-${line}`}
              type="button"
              onClick={() => toggle(i)}
              aria-pressed={on}
              className={cn(
                'block w-full min-h-[44px] text-left rounded-2xl px-3 py-2 text-[15px] transition-colors',
                on ? 'bg-ember-500/15 text-ink-100 font-semibold ring-1 ring-inset ring-ember-500/50' : 'text-ink-200 hover:bg-ink-100/[0.06]',
              )}
            >
              {line || '♪'}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy || !sel.length}
        className="mt-4 w-full py-3 rounded-full btn-primary disabled:opacity-50"
      >
        {busy ? 'Creating…' : sel.length ? `Create card (${sel.length})` : 'Select lines'}
      </button>
    </Sheet>
  );
}
