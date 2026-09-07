import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { fetchPick, parseSongLine } from '@/components/ai/SongPick';
import type { Song } from '@/types';

/**
 * v5.12.0 — Import a playlist from text. Paste anything list-shaped — a chat
 * reply, a screenshot's text, an exported list — one song per line as
 * "Title — Artist" (or "Title - Artist", or just a title) and VinaX resolves
 * each line to the real catalogue song and saves them as a playlist. Reuses
 * the same resolver the AI chat's song cards use.
 */
function parseLines(text: string): Array<{ title: string; artist: string }> {
  const out: Array<{ title: string; artist: string }> = [];
  const seen = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*(?:[-*•]\s*|\d+[.)]\s*)/, '').trim();
    if (!line || line.length > 140) continue;
    const pick = parseSongLine(line) ?? (() => {
      const m = /^(.{2,80}?)\s+[-–—|]\s+(.{2,60})$/.exec(line);
      if (m) return { title: m[1].trim(), artist: m[2].trim() };
      // A bare title still resolves — the artist is a hint, not a requirement.
      return { title: line.replace(/["“”]/g, ''), artist: '' };
    })();
    const key = `${pick.title}|${pick.artist}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pick);
    if (out.length >= 100) break;
  }
  return out;
}

export function ImportPlaylistSheet({ onClose }: { onClose(): void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  useDismissOnBack(true, onClose);
  const createCollection = useLibraryStore((s) => s.createCollection);
  const addToCollection = useLibraryStore((s) => s.addToCollection);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const lines = parseLines(text);

  const run = async (playAfter: boolean) => {
    if (!lines.length || busy) return;
    setBusy(true);
    setProgress({ done: 0, total: lines.length });
    const songs: Song[] = [];
    const seen = new Set<string>();
    // Small batches keep the catalogue API happy and the progress honest.
    for (let i = 0; i < lines.length; i += 4) {
      const batch = lines.slice(i, i + 4);
      const found = await Promise.all(batch.map((p) => fetchPick(qc, p).catch(() => null)));
      for (const s of found) if (s && !seen.has(s.id)) { seen.add(s.id); songs.push(s); }
      setProgress({ done: Math.min(lines.length, i + batch.length), total: lines.length });
    }
    setBusy(false);
    if (!songs.length) {
      toast('None of those lines matched a song — try "Title — Artist" per line');
      return;
    }
    const title = name.trim() || `Imported ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
    const id = createCollection(title);
    for (const s of songs) addToCollection(id, s);
    const missed = lines.length - songs.length;
    toast(missed ? `Saved “${title}” — ${songs.length} found, ${missed} not matched` : `Saved “${title}” with ${songs.length} songs`);
    if (playAfter) playQueue(songs, 0);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Import a playlist from text"
        className="w-full sm:max-w-lg glass-modal rounded-t-3xl sm:rounded-3xl p-5 animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">Import a playlist</h2>
        <p className="text-xs text-ink-400 mt-0.5 mb-3">One song per line — <b>Title — Artist</b> works best; a bare title is fine too.</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Playlist name (optional)"
          className="w-full mb-2 px-3 py-2 rounded-full bg-ink-800 text-sm outline-none placeholder:text-ink-400 focus:ring-1 focus:ring-ink-100"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder={'Kesariya — Arijit Singh\nSrivalli — Sid Sriram\nNaatu Naatu'}
          className="w-full px-3 py-2 rounded-2xl bg-ink-800 text-sm outline-none resize-none placeholder:text-ink-500 focus:ring-1 focus:ring-ink-100 font-mono"
        />
        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-400">
          <span>{lines.length ? `${lines.length} song${lines.length === 1 ? '' : 's'} to look up` : 'Paste a list to begin'}</span>
          {busy && <span>Finding {progress.done}/{progress.total}…</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
          <button onClick={() => void run(true)} disabled={!lines.length || busy} className="btn-secondary px-4 py-2 text-sm disabled:opacity-50">
            Save &amp; play
          </button>
          <button onClick={() => void run(false)} disabled={!lines.length || busy} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {busy ? 'Importing…' : 'Save playlist'}
          </button>
        </div>
      </div>
    </div>
  );
}
