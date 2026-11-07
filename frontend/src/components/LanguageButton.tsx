import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDownIcon, GlobeIcon } from './Icons';
import { useSettingsStore } from '@/store/settingsStore';
import { languageLabel } from '@/constants/languages';

// The picker itself loads the first time it opens.
const LanguagePicker = lazy(() => import('./LanguagePicker'));

/** "Music languages" with the current choice under it; opens the picker. */
export default function LanguageButton() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  const names = pinned.map(languageLabel);
  const short = names.length ? `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ''}` : 'Pick';
  return (
    <>
      <button ref={btn} type="button" className="vx-langbtn" title={`Music languages: ${names.join(', ') || 'none picked'}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <GlobeIcon className="w-[18px] h-[18px] md:hidden" />
        <span className="vx-langbtn-text">
          {/* The name is the visible text (WCAG label-in-name); on a phone that is "Telugu +1", with this hidden prefix. */}
          <span className="sr-only md:not-sr-only md:block">Music languages<span className="sr-only">: </span></span>
          <small><span className="md:hidden">{short}</span><span className="hidden md:inline">{names.join(', ') || 'Pick yours'}</span></small>
        </span>
        <ChevronDownIcon className="w-4 h-4 hidden md:block" />
      </button>
      {open && (
        <Suspense fallback={null}>
          <LanguagePicker onClose={close} anchor={btn} />
        </Suspense>
      )}
    </>
  );
}

