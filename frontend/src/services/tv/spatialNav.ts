/**
 * D-pad / arrow-key spatial navigation for TV & set-top-box browsers
 * (Android TV, tvOS web, Tizen/WebOS, Fire TV, Jio/Airtel boxes, etc.).
 *
 * Enabled ONLY on TV-like devices, so desktop/laptop keyboard shortcuts
 * (arrow-to-seek) are completely untouched. On TV, pressing an arrow moves
 * focus to the nearest focusable element in that direction; Enter activates it
 * (native for buttons/links). Runs in the capture phase + stops propagation so
 * it cleanly takes precedence over other key handlers.
 */
type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

function isTvLike(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (
    /TV|BRAVIA|Web0S|WEBOS|Tizen|SMART-?TV|SmartTV|AFT|GoogleTV|Android ?TV|HbbTV|NetCast|Roku|VIDAA|MiBOX|MiTV|DLNADOC|STB/i.test(
      ua,
    )
  )
    return true;
  try {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches && window.innerWidth >= 1280;
  } catch {
    return false;
  }
}

function focusables(): HTMLElement[] {
  const sel =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(
    (el) => el.offsetWidth > 0 && el.offsetHeight > 0 && el.getAttribute('aria-hidden') !== 'true',
  );
}

/** Inputs/sliders/textareas handle their own arrow keys — never hijack them. */
function ownsArrows(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

function pick(current: HTMLElement, dir: Dir): HTMLElement | null {
  const cr = current.getBoundingClientRect();
  const ccx = cr.left + cr.width / 2;
  const ccy = cr.top + cr.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of focusables()) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - ccx;
    const dy = r.top + r.height / 2 - ccy;
    let primary: number;
    let cross: number;
    if (dir === 'right') {
      if (r.left < cr.right - 4) continue;
      primary = dx;
      cross = Math.abs(dy);
    } else if (dir === 'left') {
      if (r.right > cr.left + 4) continue;
      primary = -dx;
      cross = Math.abs(dy);
    } else if (dir === 'down') {
      if (r.top < cr.bottom - 4) continue;
      primary = dy;
      cross = Math.abs(dx);
    } else {
      if (r.bottom > cr.top + 4) continue;
      primary = -dy;
      cross = Math.abs(dx);
    }
    if (primary <= 0) continue;
    const score = primary + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

let started = false;
export function initSpatialNav(): void {
  if (started || !isTvLike()) return;
  started = true;
  document.documentElement.classList.add('tv');
  window.addEventListener(
    'keydown',
    (e) => {
      const dir = DIRS[e.key];
      if (!dir) return;
      const active = document.activeElement as HTMLElement | null;
      if (ownsArrows(active)) return;
      if (!active || active === document.body) {
        const all = focusables();
        if (all.length) {
          all[0].focus();
          e.preventDefault();
        }
        return;
      }
      const next = pick(active, dir);
      if (next) {
        next.focus();
        next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
}
