import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { writeLocalBatch } from '@/services/storage/local';
import { downloadProfileExport } from './actions';
import {
  BACKUP_CATEGORIES,
  BACKUP_EXCLUSIONS,
  applyBackup,
  backupMeta,
  currentCategoryValues,
  parseBackup,
  type BackupCategoryId,
  type ParsedBackup,
  type RestoreMode,
} from './backup';

/** Where the pre-restore safety copy lives until the tab closes. */
export const RESTORE_UNDO_KEY = 'vinax.backup.undo.v1';

interface UndoSnapshot {
  at: number;
  entries: Array<[string, string | null]>;
}

function readUndo(): UndoSnapshot | null {
  try {
    const raw = sessionStorage.getItem(RESTORE_UNDO_KEY);
    const v = raw ? (JSON.parse(raw) as UndoSnapshot) : null;
    return v && Array.isArray(v.entries) ? v : null;
  } catch {
    return null;
  }
}

/** Snapshot the keys a restore will touch; false when the browser cannot keep it. */
function keepUndo(ids: readonly BackupCategoryId[]): boolean {
  const entries: Array<[string, string | null]> = [];
  for (const cat of BACKUP_CATEGORIES) {
    if (!ids.includes(cat.id)) continue;
    for (const spec of cat.keys) {
      try {
        entries.push([spec.key, localStorage.getItem(spec.key)]);
      } catch {
        /* unreadable key: nothing to restore */
      }
    }
  }
  try {
    sessionStorage.setItem(RESTORE_UNDO_KEY, JSON.stringify({ at: Date.now(), entries } satisfies UndoSnapshot));
    return true;
  } catch {
    return false;
  }
}

const when = (ts?: number): string => (ts ? new Date(ts).toLocaleString() : 'never');
const kb = (n?: number): string => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '');

/**
 * v6.1.0 — Backup Center: what a backup holds (with live counts), what it
 * deliberately leaves out, when the last export/restore happened, and a
 * restore flow that previews every category against what is on the device
 * before anything is written — merge or replace — with a safety copy and
 * an Undo that survives the reload.
 */
export function BackupCenter({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  useDismissOnBack(true, onClose);
  const fileRef = useRef<HTMLInputElement>(null);
  const [meta, setMeta] = useState(backupMeta);
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [chosen, setChosen] = useState<Set<BackupCategoryId>>(() => new Set());
  const [applying, setApplying] = useState(false);
  const [undo, setUndo] = useState<UndoSnapshot | null>(readUndo);

  const current = useMemo(
    () => BACKUP_CATEGORIES.map((cat) => ({ cat, values: currentCategoryValues(cat) })).map(({ cat, values }) => ({ cat, summary: Object.keys(values).length ? cat.summarize(values) : 'Nothing stored yet', empty: !Object.keys(values).length })),
    [],
  );
  useEffect(() => setMeta(backupMeta()), [parsed]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setParseError(null);
    setParsed(null);
    const res = parseBackup(await file.text());
    if (!res.ok) {
      setParseError(res.error);
      return;
    }
    setParsed(res);
    setChosen(new Set(res.categories.map((c) => c.id)));
  };

  const toggle = (id: BackupCategoryId) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const restore = () => {
    if (!parsed || !chosen.size || applying) return;
    setApplying(true);
    const ids = [...chosen];
    const kept = keepUndo(ids);
    const res = applyBackup(parsed, { mode, categories: ids });
    if (!res.ok) {
      setApplying(false);
      try {
        sessionStorage.removeItem(RESTORE_UNDO_KEY);
      } catch {
        /* nothing kept */
      }
      toast(`${res.message}${res.rolledBack ? '' : ' Some keys could not be rolled back — restore your safety copy.'}`, { duration: 9000 });
      return;
    }
    toast(kept ? 'Restored. Reloading — you can undo from the Backup Center.' : 'Restored. Reloading.');
    window.setTimeout(() => window.location.reload(), 400);
  };

  const undoRestore = () => {
    if (!undo) return;
    const res = writeLocalBatch(undo.entries);
    if (!res.ok) {
      toast(res.message, { duration: 8000 });
      return;
    }
    try {
      sessionStorage.removeItem(RESTORE_UNDO_KEY);
    } catch {
      /* ignore */
    }
    setUndo(null);
    toast('Restore undone. Reloading.');
    window.setTimeout(() => window.location.reload(), 400);
  };

  const box = 'rounded-2xl border border-[var(--glass-border)] bg-[var(--tile)] p-3';

  // Portal: see note in SmartCollectionSheet — fixed overlays must not live inside a transformed page section.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-center-title"
        className="w-full sm:max-w-2xl glass-modal rounded-t-3xl sm:rounded-3xl p-5 max-h-[92vh] overflow-y-auto animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="backup-center-title" className="text-lg font-bold">Backup Center</h2>
        <p className="text-xs text-ink-400 mt-0.5 mb-4">
          A backup is a JSON file of the data you built up in VinaX. It never contains downloaded audio — only the list of what you saved — and never your device identity.
        </p>

        {undo && (
          <div role="status" className={cn(box, 'mb-4 border-amber-400/40')}>
            <p className="text-sm font-semibold">A restore was applied {when(undo.at)}.</p>
            <p className="text-xs text-ink-400 mt-0.5">The previous data is kept in this tab until you close it.</p>
            <button onClick={undoRestore} className="mt-2 px-4 py-2 rounded-full glass-button text-sm min-h-[40px]">Undo that restore</button>
          </div>
        )}

        <section aria-labelledby="backup-included" className="mb-4">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h3 id="backup-included" className="text-sm font-bold">What a backup includes</h3>
            <span className="text-[11px] text-ink-400">Last export: {when(meta.lastExportAt)}{meta.lastExportBytes ? ` · ${kb(meta.lastExportBytes)}` : ''}</span>
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {current.map(({ cat, summary, empty }) => (
              <li key={cat.id} className={cn(box, empty && 'opacity-60')}>
                <p className="text-sm font-semibold">{cat.label}</p>
                <p className="text-[11px] text-ink-400">{cat.description}</p>
                <p className="text-xs text-ink-200 mt-1">{summary}</p>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <button onClick={() => { downloadProfileExport(); setMeta(backupMeta()); toast('Backup file downloaded'); }} className="px-4 py-2 rounded-full btn-primary text-sm min-h-[44px]">Export a backup now</button>
            {meta.lastImportAt && <span className="text-[11px] text-ink-400">Last restore: {when(meta.lastImportAt)} ({meta.lastImportMode})</span>}
          </div>
        </section>

        <section aria-labelledby="backup-excluded" className="mb-4">
          <h3 id="backup-excluded" className="text-sm font-bold mb-2">What it leaves out, and why</h3>
          <ul className="space-y-1">
            {BACKUP_EXCLUSIONS.map((x) => (
              <li key={x.label} className="text-xs"><b>{x.label}</b> <span className="text-ink-400">— {x.why}</span></li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="backup-restore">
          <h3 id="backup-restore" className="text-sm font-bold mb-2">Restore from a file</h3>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" aria-label="Choose a VinaX backup file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f); }} />
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={() => fileRef.current?.click()} className="px-4 py-2 rounded-full glass-button text-sm min-h-[44px]">Choose a backup file…</button>
            <span className="text-[11px] text-ink-400">You will see what is inside before anything changes.</span>
          </div>
          {parseError && <p role="alert" className="mt-2 text-xs text-red-300">{parseError}</p>}

          {parsed && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-ink-300">
                Backup from {parsed.file.exportedAt ? new Date(parsed.file.exportedAt).toLocaleString() : 'an unknown date'}{parsed.file.appVersion ? ` · VinaX ${parsed.file.appVersion}` : ''}
                {parsed.migratedFrom && ' · older export format, migrated'}
              </p>
              {parsed.warnings.map((w) => <p key={w} className="text-[11px] text-amber-300">{w}</p>)}
              {parsed.rejected.length > 0 && (
                <div role="alert" className={cn(box, 'border-red-400/40')}>
                  <p className="text-xs font-semibold text-red-300">Damaged sections are left out:</p>
                  <ul className="text-[11px] text-ink-300 list-disc pl-4">
                    {parsed.rejected.map((r) => <li key={r.id}>{r.label}: {r.error}</li>)}
                  </ul>
                </div>
              )}

              <fieldset>
                <legend className="text-xs font-semibold text-ink-300 mb-1.5">How to apply</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['merge', 'replace'] as RestoreMode[]).map((m) => (
                    <label key={m} className={cn(box, 'flex gap-2 cursor-pointer', mode === m && 'border-ember-500')}>
                      <input type="radio" name="restore-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-0.5 accent-[rgb(var(--ember-400))]" />
                      <span>
                        <span className="block text-sm font-semibold">{m === 'merge' ? 'Merge' : 'Replace'}</span>
                        <span className="block text-[11px] text-ink-400">
                          {m === 'merge'
                            ? 'Keeps everything on this device and adds what the file has. A song, playlist, bookmark or saved search that is already here is never added twice; settings from the file win.'
                            : 'The chosen categories become exactly what the file holds. Anything in those categories that is only on this device is removed.'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs font-semibold text-ink-300 mb-1.5">Preview — file vs this device</legend>
                <ul className="space-y-1.5">
                  {parsed.categories.map((c) => {
                    const cur = current.find((x) => x.cat.id === c.id);
                    return (
                      <li key={c.id} className={cn(box, 'flex gap-3 items-start')}>
                        <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Restore ${c.label}`} className="mt-1 w-4 h-4 accent-[rgb(var(--ember-400))]" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{c.label}</span>
                          <span className="block text-[11px] text-ink-400">In file: <span className="text-ink-200">{c.summary}</span></span>
                          <span className="block text-[11px] text-ink-400">On this device: <span className="text-ink-200">{cur?.summary ?? 'Nothing stored yet'}</span></span>
                          {c.id === 'identity' && <span className="block text-[11px] text-amber-300">The username in the file is re-confirmed with the service after restore; it may already be taken.</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>

              <div className="flex flex-wrap gap-2 justify-end items-center">
                <button onClick={() => { downloadProfileExport(); setMeta(backupMeta()); toast('Safety copy downloaded'); }} className="px-4 py-2 rounded-full border border-ink-600 text-sm min-h-[44px] mr-auto">Download a safety copy first</button>
                <button onClick={() => setParsed(null)} className="btn-secondary px-4 py-2 text-sm min-h-[44px]">Cancel</button>
                <button onClick={restore} disabled={!chosen.size || applying} className="btn-primary px-4 py-2 text-sm min-h-[44px] disabled:opacity-50">
                  {applying ? 'Restoring…' : `${mode === 'merge' ? 'Merge' : 'Replace'} ${chosen.size} categor${chosen.size === 1 ? 'y' : 'ies'}`}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  , document.body);
}
