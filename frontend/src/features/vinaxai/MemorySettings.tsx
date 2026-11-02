/**
 * VinaX AI settings → Memory: the two switches (kept with the account, as
 * learning runs on the server), every note with its own Delete, Add a
 * memory, and Forget everything. See docs/ai.md "Memory".
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/store/toastStore';
import { addMemory, AiError, deleteMemory, forgetAllMemory, getMemory, memoryNotice, setMemoryPrefs } from './api';
import { shareDate } from './ShareDialog';
import { TrashIcon } from './icons';
import type { MemoryPrefs, MemoryState } from './types';

export const MEMORY_KEY = ['vinaxai', 'memory'] as const;
export const MEMORY_MAX_CHARS = 200;

const codeOf = (e: unknown): string => (e instanceof AiError ? e.code : 'network');

export function MemorySettings(): ReactNode {
  const qc = useQueryClient();
  const memory = useQuery({ queryKey: MEMORY_KEY, queryFn: getMemory, staleTime: 0, retry: 1 });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const forgetBtn = useRef<HTMLButtonElement>(null);
  const patch = (fn: (d: MemoryState) => MemoryState) => qc.setQueryData<MemoryState>(MEMORY_KEY, (d) => (d ? fn(d) : d));

  // The confirmation takes focus; cancelling gives it back to Forget everything.
  const wasAsking = useRef(false);
  useEffect(() => {
    if (asking) box.current?.querySelector<HTMLElement>('.vx-ai-mem-ask button')?.focus();
    else if (wasAsking.current) (forgetBtn.current ?? box.current)?.focus();
    wasAsking.current = asking;
  }, [asking]);

  const setPrefs = async (next: Partial<MemoryPrefs>) => {
    const before = memory.data?.prefs;
    patch((d) => ({ ...d, prefs: { ...d.prefs, ...next } }));
    try {
      const r = await setMemoryPrefs(next);
      patch((d) => ({ ...d, prefs: r.prefs }));
    } catch (e) {
      if (before) patch((d) => ({ ...d, prefs: before }));
      toast(memoryNotice(codeOf(e)));
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const { item } = await addMemory(text);
      patch((d) => ({ ...d, items: d.items.some((x) => x.id === item.id) ? d.items : [...d.items, item] }));
      setDraft('');
      toast('Memory added');
    } catch (err) {
      toast(memoryNotice(codeOf(err)));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, index: number) => {
    try {
      await deleteMemory(id);
    } catch (err) {
      if (codeOf(err) !== 'not_found') { toast(memoryNotice(codeOf(err))); return; }
    }
    patch((d) => ({ ...d, items: d.items.filter((x) => x.id !== id) }));
    toast('Memory deleted');
    // Focus the next note's Delete (or the previous one, or the list) so it never drops out of the dialog.
    requestAnimationFrame(() => {
      const buttons = box.current?.querySelectorAll<HTMLElement>('.vx-ai-mem-list button');
      (buttons?.[Math.min(index, (buttons?.length ?? 1) - 1)] ?? box.current)?.focus();
    });
  };

  const forgetAll = async () => {
    setBusy(true);
    try {
      await forgetAllMemory();
      patch((d) => ({ ...d, items: [] }));
      toast('Memory cleared');
      setAsking(false);
    } catch (err) {
      toast(memoryNotice(codeOf(err)));
    } finally {
      setBusy(false);
    }
  };

  const data = memory.data;
  const items = data?.items ?? [];
  const use = data?.prefs.use ?? true;
  const learn = data?.prefs.learn ?? true;
  const full = !!data && items.length >= data.max;
  return (
    <div className="vx-ai-mem" ref={box} tabIndex={-1}>
      {memory.isPending && <p className="vx-ai-settings-note" aria-busy="true">Loading…</p>}
      {memory.isError && (
        <p className="vx-ai-settings-note">
          Couldn’t load your memory. <button type="button" className="vx-ai-mem-retry" onClick={() => void memory.refetch()}>Try again</button>
        </p>
      )}
      {data && (
        <>
          {!data.enabled && <p className="vx-ai-settings-note" role="status">Memory is switched off for VinaX AI right now. You can still see and delete what’s saved.</p>}
          <button type="button" role="switch" id="vx-ai-set-memuse" aria-checked={use} className="vx-ai-setting-switch" onClick={() => void setPrefs({ use: !use })}>
            <span className="vx-ai-menu-text">
              <span>Use memory</span>
              <span className="vx-ai-opt-sub">VinaX AI uses what it remembers about you in new replies</span>
            </span>
            <span className={`vx-ai-switch${use ? ' is-on' : ''}`} aria-hidden />
          </button>
          <button type="button" role="switch" id="vx-ai-set-memlearn" aria-checked={use && learn} disabled={!use} className="vx-ai-setting-switch" onClick={() => void setPrefs({ learn: !learn })}>
            <span className="vx-ai-menu-text">
              <span>Learn from my chats</span>
              <span className="vx-ai-opt-sub">Saves lasting details you share, like your work or what you’re learning</span>
            </span>
            <span className={`vx-ai-switch${use && learn ? ' is-on' : ''}`} aria-hidden />
          </button>

          <h4 id="vx-ai-mem-h">What VinaX AI remembers{items.length ? ` (${items.length})` : ''}</h4>
          {!items.length && <p className="vx-ai-settings-note">Nothing yet. {use && learn ? 'VinaX AI saves lasting details as you chat, or add one below.' : 'Add one below.'}</p>}
          {items.length > 0 && (
            <ul className="vx-ai-mem-list" aria-labelledby="vx-ai-mem-h">
              {items.map((m, i) => (
                <li key={m.id}>
                  <div className="vx-ai-links-text">
                    <span className="vx-ai-mem-text">{m.text}</span>
                    <span className="vx-ai-opt-sub">{m.origin === 'user' ? 'Added by you' : 'Learned from a chat'} · {shareDate(m.createdAt)}</span>
                  </div>
                  <button type="button" className="vx-ai-act" onClick={() => void remove(m.id, i)} aria-label={`Delete memory: ${m.text}`} title="Delete">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="vx-ai-field vx-ai-mem-add" onSubmit={(e) => void add(e)}>
            <label htmlFor="vx-ai-set-memadd">Add a memory</label>
            <div className="vx-ai-mem-row">
              <input
                id="vx-ai-set-memadd"
                type="text"
                maxLength={MEMORY_MAX_CHARS}
                value={draft}
                disabled={!data.enabled || full}
                aria-describedby="vx-ai-set-memadd-hint"
                placeholder="I’m learning Carnatic vocals"
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit" className="vx-ai-chip" disabled={busy || !draft.trim() || !data.enabled || full}>Add</button>
            </div>
            <small id="vx-ai-set-memadd-hint">{full ? 'Memory is full. Delete a memory to add another.' : 'A short fact or preference. Never passwords, numbers or contact details.'}</small>
          </form>

          {items.length > 0 && (asking ? (
            <span className="vx-ai-mem-ask" role="group" aria-label="Forget everything VinaX AI remembers?">
              <button type="button" className="vx-ai-chip" onClick={() => setAsking(false)}>Keep</button>
              <button type="button" className="vx-ai-chip is-danger" disabled={busy} onClick={() => void forgetAll()}>Forget all {items.length}</button>
            </span>
          ) : (
            <button ref={forgetBtn} type="button" className="vx-ai-chip" onClick={() => setAsking(true)}>Forget everything</button>
          ))}
        </>
      )}
      <p className="vx-ai-settings-note">Kept with your account until you delete it, and deleted with your account. Incognito chats don’t use it or add to it, and shared chats never include it.</p>
    </div>
  );
}
