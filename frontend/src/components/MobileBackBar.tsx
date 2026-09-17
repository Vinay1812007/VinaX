import { useLocation, useNavigate } from 'react-router-dom';

const DETAIL_ROUTE = /^\/(song|album|playlist|artist|lyrics)\//;

/** back affordance on stacked detail pages (mobile only). */
export function MobileBackBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (!DETAIL_ROUTE.test(pathname)) return null;
  return (
    // Sticks directly UNDER the sticky top bar. Its height (status-bar inset
    // included) is the --vx-topbar-h token, so this strip follows it on notched
    // phones and whenever the bar is resized. -mx-4 mirrors <main>'s px-4.
    <div className="md:hidden sticky top-[var(--vx-topbar-h)] z-30 -mx-4 px-3 py-1 glass-navbar">
      <button
        type="button"
        onClick={() => window.history.length > 1 ? navigate(-1) : navigate("/")}
        aria-label="Back"
        className="inline-flex items-center gap-1 min-h-touch px-2 py-1.5 rounded-full text-sm font-semibold text-ink-200 hover:text-ink-100 active:scale-95"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </button>
    </div>
  );
}
