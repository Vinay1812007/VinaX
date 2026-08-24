import { useState, useRef } from 'react';
import type { Song } from '@/types';
import { cn } from '@/utils/cn';
import { toast } from '@/store/toastStore';
import { shareOrSaveImage } from '@/utils/shareImage';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { useFocusTrap } from '@/hooks/useFocusTrap';

const MAX = 6;
const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

async function renderLyricCard(lines: string[], song: Song): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1080;
  const x = c.getContext('2d');
  if (!x) throw new Error('no canvas');

  const bg = x.createLinearGradient(0, 0, 0, 1080);
  bg.addColorStop(0, '#15101c');
  bg.addColorStop(1, '#08080c');
  x.fillStyle = bg;
  x.fillRect(0, 0, 1080, 1080);
  const glow = x.createRadialGradient(220, 200, 0, 220, 200, 680);
  glow.addColorStop(0, 'rgba(99,102,241,0.32)');
  glow.addColorStop(1, 'rgba(99,102,241,0)');
  x.fillStyle = glow;
  x.fillRect(0, 0, 1080, 1080);

  x.fillStyle = 'rgba(255,138,76,0.55)';
  x.font = '800 200px Georgia, serif';
  x.fillText('“', 80, 290);

  const fontSize = lines.length <= 2 ? 76 : lines.length <= 4 ? 62 : 50;
  x.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
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

  x.fillStyle = '#cfcfda';
  x.font = '700 40px -apple-system, BlinkMacSystemFont, sans-serif';
  x.fillText(trunc(song.title, 28), 90, 952);
  x.fillStyle = '#8a8a99';
  x.font = '500 34px -apple-system, BlinkMacSystemFont, sans-serif';
  x.fillText(trunc(song.subtitle, 38), 90, 1000);
  x.fillStyle = '#6f6f7e';
  x.font = '600 30px -apple-system, BlinkMacSystemFont, sans-serif';
  x.fillText('VinaX', 930, 1000);

  return await new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'),
  );
}

export function LyricShareSheet({ lines, song, onClose }: { lines: string[]; song: Song; onClose: () => void }) {
  useDismissOnBack(true, onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true, onClose);
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
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-ink-950/80 backdrop-blur-sm p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Share lyrics"
        className="w-full sm:max-w-md glass-modal rounded-t-3xl sm:rounded-3xl p-5 max-h-[85vh] flex flex-col animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">Share lyrics</h2>
          <button onClick={onClose} className="text-ink-400 text-sm hover:text-ink-100">Close</button>
        </div>
        <p className="text-xs text-ink-400 mb-3">Tap up to {MAX} lines, then create your card.</p>
        <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-1">
          {lines.map((line, i) => (
            <button
              key={`${i}-${line}`}
              onClick={() => toggle(i)}
              className={cn(
                'block w-full text-left rounded-xl px-3 py-2 text-sm transition-colors',
                sel.includes(i)
                  ? 'bg-ember-500/20 text-ember-200 ring-1 ring-ember-500/40'
                  : 'text-ink-200 hover:bg-ink-800/50',
              )}
            >
              {line || '♪'}
            </button>
          ))}
        </div>
        <button
          onClick={() => void create()}
          disabled={busy || !sel.length}
          className="mt-4 w-full py-3 rounded-full btn-primary disabled:opacity-50"
        >
          {busy ? 'Creating…' : sel.length ? `Create card (${sel.length})` : 'Select lines'}
        </button>
      </div>
    </div>
  );
}
