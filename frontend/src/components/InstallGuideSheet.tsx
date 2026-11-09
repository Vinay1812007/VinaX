import { Sheet, SheetHeader } from './Sheet';

/**
 * 1.12 — "Add to Home Screen" on an iPhone or iPad, shown step by step. Safari
 * has no install prompt, so the bar's "How" opens this: the three taps, each
 * with the icon to look for. VinaX then opens full-screen, keeps playing with
 * the screen off and shows the song on the lock screen like an app.
 */
export function InstallGuideSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="install-guide-title" size="sm">
      <SheetHeader id="install-guide-title" title="Add VinaX to your Home Screen" subtitle="Three taps in Safari. Then it opens like an app, plays with the screen off, and shows the song on your lock screen." onClose={onClose} />
      <ol className="vx-install-steps" aria-label="Steps">
        <li>
          <span className="vx-install-glyph" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4" /><path d="M8 8l4-4 4 4" /><path d="M6 11v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8" /></svg>
          </span>
          <span className="vx-install-text"><strong>Tap Share</strong> — the square with an arrow at the bottom of Safari (top right on an iPad).</span>
        </li>
        <li>
          <span className="vx-install-glyph" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M8 12h8" /></svg>
          </span>
          <span className="vx-install-text"><strong>Scroll down and tap “Add to Home Screen”</strong> — the square with a plus.</span>
        </li>
        <li>
          <span className="vx-install-glyph" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4L19 6" /></svg>
          </span>
          <span className="vx-install-text"><strong>Tap “Add”</strong> at the top right. VinaX is now on your Home Screen; open it from there.</span>
        </li>
      </ol>
      <p className="vx-install-note">Not seeing “Add to Home Screen”? It is only in Safari — open vinaxmusic.online there, not in Chrome or inside another app.</p>
      <button type="button" onClick={onDone} className="vx-tap w-full min-h-[48px] rounded-full btn-primary font-semibold mt-2">Got it</button>
    </Sheet>
  );
}
