/**
 * Cosmetic deterrence for production web builds. THIS IS NOT SECURITY — there
 * are no secrets in this client. It discourages casual inspection (devtools
 * shortcuts, right-click, drag, text selection). Inputs stay fully usable so
 * search/forms and keyboard navigation are never impaired.
 */
export function installDeterrence(): void {
  if (import.meta.env.DEV) return;
  document.documentElement.classList.add('deter');

  const isEditable = (el: HTMLElement | null): boolean =>
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

  document.addEventListener('contextmenu', (e) => {
    if (!isEditable(e.target as HTMLElement)) e.preventDefault();
  });
  document.addEventListener('dragstart', (e) => {
    if (!isEditable(e.target as HTMLElement)) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if (isEditable(e.target as HTMLElement)) return;
    const k = e.key.toUpperCase();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F12') {
      e.preventDefault();
      return;
    }
    // devtools (I/J/C), view-source (U), save (S)
    if ((mod && e.shiftKey && ['I', 'J', 'C'].includes(k)) || (mod && (k === 'U' || k === 'S'))) {
      e.preventDefault();
    }
  });
}
