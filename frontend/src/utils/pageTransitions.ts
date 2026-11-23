import type { createBrowserRouter } from 'react-router-dom';
import { reducedMotion } from './motion';

type AppRouter = ReturnType<typeof createBrowserRouter>;

/** Routes that are one screen whatever their address says: moving inside one is not a page change. */
function section(path: string): string {
  if (path.startsWith('/search')) return '/search';
  if (path.startsWith('/vinaxai')) return '/vinaxai';
  return path.replace(/\/$/, '') || '/';
}

/**
 * Design system v2 — page changes become View Transitions (README.md › Design
 * system › Motion). Every in-app navigation goes through `router.navigate`
 * (links and useNavigate alike), so one wrapper turns the transition on for
 * all of them; react-router then runs the DOM update inside
 * document.startViewTransition and replays it on Back.
 *
 * The page area and the playing artwork get their view-transition-name only
 * while a transition runs (.vx-vt-on on <html>, shell.css): a named element
 * is a "backdrop root", and a permanent name would stop the glass chrome
 * inside it from blurring what is behind.
 *
 * Skipped for replace navigations (redirects, filters), moves inside one
 * screen (search queries, chat threads), reduced motion, phones and tablets,
 * and browsers without the API — those keep the CSS page entrance.
 */
/**
 * 1.21.1 — phones and tablets (a touch screen, or narrower than 1024px) skip
 * the transition and keep the light CSS entrance. Measured with a 4x CPU
 * throttle on a 390px screen: the new page was only usable when the
 * transition finished, 330–470 ms after each tab tap, with taps blocked
 * meanwhile; without it the page is on screen in 36–144 ms.
 */
const COMPACT = '(pointer: coarse), (max-width: 1023px)';
function compactScreen(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(COMPACT).matches;
}

export function enablePageTransitions(router: AppRouter): void {
  if (typeof document === 'undefined' || typeof (document as { startViewTransition?: unknown }).startViewTransition !== 'function') return;
  const root = document.documentElement;
  root.classList.add('vx-vt');
  let timer = 0;
  // Names go on before the old page is captured (the next frame) and come off
  // once the longest page animation is over.
  const arm = () => {
    root.classList.add('vx-vt-on');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => root.classList.remove('vx-vt-on'), 900);
  };
  // Back and Forward: react-router replays the transition on its own.
  window.addEventListener('popstate', () => {
    if (!reducedMotion() && !compactScreen()) arm();
  });
  const navigate = router.navigate;
  router.navigate = ((to: Parameters<AppRouter['navigate']>[0], opts?: Parameters<AppRouter['navigate']>[1]) => {
    if (typeof to === 'number' || opts?.replace || reducedMotion() || compactScreen()) return navigate(to, opts);
    const here = router.state.location.pathname;
    let next = here;
    try {
      next = typeof to === 'string' ? new URL(to, window.location.href).pathname : to?.pathname ?? here;
    } catch {
      /* an odd address: no transition */
    }
    if (section(next) === section(here) || opts?.viewTransition === false) return navigate(to, opts);
    arm();
    // <Link> passes `viewTransition: undefined` explicitly, so it must not win a spread.
    return navigate(to, { ...opts, viewTransition: true });
  }) as AppRouter['navigate'];
}
