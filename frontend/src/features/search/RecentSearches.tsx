import { useEffect, useRef, useState } from 'react';
import { ClockIcon, XIcon } from '@/components/Icons';
import { IconButton } from '@/components/IconButton';
import { SectionHeader } from '@/components/SectionHeader';
import { cn } from '@/utils/cn';

/** v5.17.0 — a small push-pin, used on pinned recents. */
export function PinGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M9 3h6l-1 6.5 3 2.5v2H7v-2l3-2.5L9 3z" />
      <path d="M12 14v7" />
    </svg>
  );
}

/** v5.17.0 — one recent search: tap opens it, long-press (or the pin
 *  button) pins it to the front, × forgets it.
 *  8.0.0 — a list row (clock or pin sleeve, the words, then the tools). Pin
 *  and × fade in on hover or keyboard focus; on touch screens only × stays
 *  visible and long-press does the pinning. */
function RecentRow({
  query,
  pinned,
  onOpen,
  onTogglePin,
  onRemove,
}: {
  query: string;
  pinned: boolean;
  onOpen: () => void;
  onTogglePin: (viaLongPress: boolean) => void;
  onRemove: () => void;
}) {
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  return (
    <li className="search-recent-row">
      <button
        type="button"
        className="search-recent-open"
        onPointerDown={() => {
          longPressed.current = false;
          cancel();
          timer.current = window.setTimeout(() => {
            longPressed.current = true;
            onTogglePin(true);
          }, 550);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => {
          // A long-press on touch also raises contextmenu — swallow it once.
          if (longPressed.current) e.preventDefault();
        }}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onOpen();
        }}
      >
        <span className={cn('search-recent-icon', pinned && 'is-pinned')} aria-hidden>
          {pinned ? <PinGlyph /> : <ClockIcon />}
        </span>
        <span className="min-w-0">
          <span className="search-recent-text">{query}</span>
          {pinned && <span className="search-recent-meta">Pinned</span>}
        </span>
      </button>
      <span className="search-recent-tools">
        <IconButton
          size="sm"
          label={pinned ? `Unpin ${query}` : `Pin ${query}`}
          aria-pressed={pinned}
          onClick={() => onTogglePin(false)}
          className="search-recent-tool search-recent-pin"
        >
          <PinGlyph className="w-4 h-4" />
        </IconButton>
        <IconButton size="sm" label={`Remove ${query}`} onClick={onRemove} className="search-recent-tool">
          <XIcon className="w-4 h-4" />
        </IconButton>
      </span>
    </li>
  );
}

/** How many recents show before "Show all": a long history must not bury the page. */
const RECENT_PREVIEW = 6;

/**
 * Recent searches, pinned ones first (in pin order), then the rest as
 * recorded. Pinned searches always show; the rest fold after six.
 */
export function RecentSearches({
  ordered,
  pinned,
  onOpen,
  onTogglePin,
  onRemove,
  onClear,
}: {
  ordered: string[];
  pinned: string[];
  onOpen: (query: string) => void;
  onTogglePin: (query: string, viaLongPress: boolean) => void;
  onRemove: (query: string) => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cut = Math.max(RECENT_PREVIEW, pinned.filter((p) => ordered.includes(p)).length);
  const shown = expanded ? ordered : ordered.slice(0, cut);
  return (
    <section className="search-block" aria-label="Recent searches">
      <SectionHeader
        title="Recent searches"
        action={
          <button type="button" className="vx-section-link" onClick={onClear}>
            Clear all
          </button>
        }
      />
      <ul className="search-recent-list">
        {shown.map((r) => (
          <RecentRow
            key={r}
            query={r}
            pinned={pinned.includes(r)}
            onOpen={() => onOpen(r)}
            onTogglePin={(viaLongPress) => onTogglePin(r, viaLongPress)}
            onRemove={() => onRemove(r)}
          />
        ))}
      </ul>
      {ordered.length > cut && (
        <button type="button" className="bx-text-btn mt-1 -ml-3" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer' : `Show all ${ordered.length}`}
        </button>
      )}
      {pinned.length === 0 && ordered.length > 1 && (
        <p className="search-recent-tip">Long-press (or hover) a search to pin it.</p>
      )}
    </section>
  );
}
