import { useState } from 'react';
import {
  MAX_MEMORIES,
  MAX_MEMORY_CHARS,
  addMemory,
  editMemory,
  loadMemories,
  memoryEnabled,
  removeMemory,
  setMemoryEnabled,
  type MemoryEntry,
} from '../memory';

/**
 * 9.1.0 — the memory section of the chat settings: the one place a listener can
 * see everything VinaX AI remembers about them, change any of it, remove any of
 * it, and switch the whole thing off.
 *
 * Off by default. The label says what turning it off does (forgets everything),
 * because a switch that quietly kept the list ready to resume would not be the
 * promise the label makes — and ../memory.ts really does delete it.
 */
export function MemorySection({ id }: { id: string }) {
  const [on, setOn] = useState(memoryEnabled);
  const [entries, setEntries] = useState<MemoryEntry[]>(loadMemories);
  const [draft, setDraft] = useState('');

  const refresh = (): void => setEntries(loadMemories());

  return (
    <div className="ai-set-block">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="block text-[14px] font-semibold ai-t1">Let VinaX AI remember things</p>
          <p className="text-[13px] ai-t3 leading-snug mt-0.5">
            Lines you write yourself, sent with every chat so you do not have to repeat them. They stay on this device. VinaX AI never adds a
            line on its own. Turning this off forgets all of them.
          </p>
        </div>
        {/* The same switch the rest of this dialog uses (`.ai-switch`), which is
            styled off aria-checked and carries its own 44px hit area. */}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Let VinaX AI remember things"
          className="ai-switch"
          onClick={() => {
            const next = !on;
            setMemoryEnabled(next);
            setOn(next);
            refresh();
          }}
        >
          <span className="ai-switch-thumb" aria-hidden />
        </button>
      </div>

      {on && (
        <>
          <ul className="ai-mem-list" aria-label="Things VinaX AI remembers">
            {entries.length === 0 && <li className="ai-mem-empty">Nothing yet.</li>}
            {entries.map((entry) => (
              <li key={entry.id} className="ai-mem-row">
                <input
                  defaultValue={entry.text}
                  aria-label={`Remembered: ${entry.text}`}
                  maxLength={MAX_MEMORY_CHARS}
                  className="ai-field ai-mem-input"
                  onBlur={(e) => {
                    if (e.target.value !== entry.text) {
                      editMemory(entry.id, e.target.value);
                      refresh();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
                <button
                  type="button"
                  className="ai-mem-remove"
                  aria-label={`Forget: ${entry.text}`}
                  onClick={() => {
                    removeMemory(entry.id);
                    refresh();
                  }}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
          {entries.length < MAX_MEMORIES && (
            <form
              className="ai-mem-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (addMemory(draft)) {
                  setDraft('');
                  refresh();
                }
              }}
            >
              <input
                id={`${id}-new`}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_MEMORY_CHARS))}
                placeholder="e.g. I play the veena, so keep examples practical"
                aria-label="Something to remember"
                className="ai-field ai-mem-input"
              />
              <button type="submit" className="ai-mem-add" disabled={!draft.trim()}>
                Add
              </button>
            </form>
          )}
          <p className="text-[11px] ai-t3 mt-1">
            {entries.length} of {MAX_MEMORIES} · edit a line and tap away to save it
          </p>
        </>
      )}
    </div>
  );
}
