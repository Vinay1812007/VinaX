import { useLocation, useNavigate } from 'react-router-dom';

const DETAIL_ROUTE = /^\/(song|album|playlist|artist|lyrics)\//;

/** back affordance on stacked detail pages (mobile only). */
export function MobileBackBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (!DETAIL_ROUTE.test(pathname)) return null;
  return (
    // Sticks directly UNDER the sticky top bar (its height, status-bar inset
    // included, is the --vx-topbar-h token). 8.0: no strip of its own — the
    // row is transparent and only the back chip carries a surface, so
    // artwork scrolls under it cleanly.
    <div className="md:hidden sticky top-[var(--vx-topbar-h)] z-30 py-1 pointer-events-none">
      <button
        type="button"
        onClick={() => window.history.length > 1 ? navigate(-1) : navigate("/")}
        aria-label="Back"
        className="pointer-events-auto inline-flex items-center gap-1 min-h-touch pl-2 pr-3.5 rounded-full bg-ink-950/60 text-[14px] font-semibold text-ink-100 backdrop-blur-md active:scale-[0.97]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </button>
    </div>
  );
}
