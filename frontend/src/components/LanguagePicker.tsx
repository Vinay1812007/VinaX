import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { LANGUAGES } from '@/constants/languages';
import { useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import '@/styles/pages/language-picker.css';

/**
 * The top bar's "Music languages" picker: tick every language you want to
 * hear, then Update applies them all at once. It writes the same pinned
 * languages Settings, the Languages page and onboarding use, so Home,
 * Charts, Radio and the browse pages (whose queries are keyed on them)
 * reload in the new languages. Picking a muted language unmutes it.
 *
 * Loads the first time the picker opens (TopBar), so the app shell stays small.
 */
export default function LanguagePicker({ onClose, anchor }: { onClose: (refocus: boolean) => void; anchor: RefObject<HTMLElement | null> }) {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  // Kept in tap order: the first language picked leads the shelves.
  const [picked, setPicked] = useState<string[]>(pinned);
  const panel = useRef<HTMLDivElement>(null);
  // Rendered on <body> (the top bar sits under the phone's player bar), placed under the button.
  const [place, setPlace] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (r) setPlace({ top: r.bottom + 10, right: Math.max(12, window.innerWidth - r.right) });
  }, [anchor]);

  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) onClose(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose, anchor]);

  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((l) => l !== id) : [...cur, id]));
  const unchanged = picked.length === pinned.length && picked.every((l, i) => l === pinned[i]);

  const update = () => {
    const { mutedLanguages, setPinnedLanguages, setMutedLanguages } = useSettingsStore.getState();
    setPinnedLanguages(picked);
    if (mutedLanguages.some((l) => picked.includes(l))) setMutedLanguages(mutedLanguages.filter((l) => !picked.includes(l)));
    toast('Music languages updated');
    onClose(true);
  };

  return createPortal(
    <div ref={panel} id="vx-lang-picker" className="vx-langpick" style={place} role="dialog" aria-modal="false" aria-labelledby="vx-langpick-title">
      <h2 id="vx-langpick-title" className="vx-langpick-title">What music do you like?</h2>
      <p className="vx-langpick-hint">Pick all the languages you want to listen to. Home, Charts and Radio follow the first three.</p>
      <div className="vx-langpick-grid" role="group" aria-label="Music languages">
        {LANGUAGES.map((l) => {
          const on = picked.includes(l.id);
          const rank = picked.indexOf(l.id);
          return (
            <label key={l.id} className={on ? 'vx-langpick-opt is-on' : 'vx-langpick-opt'}>
              <input type="checkbox" checked={on} onChange={() => toggle(l.id)} />
              <span>{l.label}</span>
              {on && rank < 3 && <span className="vx-langpick-rank" aria-hidden>{rank + 1}</span>}
            </label>
          );
        })}
      </div>
      <div className="vx-langpick-actions">
        <button type="button" className="vx-langpick-clear" onClick={() => setPicked([])} disabled={!picked.length}>
          Clear
        </button>
        <button type="button" className="btn-primary vx-langpick-update" onClick={update} disabled={!picked.length || unchanged}>
          Update
        </button>
      </div>
    </div>,
    document.body,
  );
}
