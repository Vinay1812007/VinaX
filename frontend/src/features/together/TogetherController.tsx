import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { useTogether } from '@/services/together/session';
import { runSession, tapToListen } from './engine';
import { useRoom } from './room';
import '@/styles/pages/together.css';

/** Where the pill sits: 0…1 across the screen and down it. */
interface PillSpot {
  x: number;
  y: number;
}
/** A finger has to travel this far (px) before a press becomes a drag. */
const DRAG_START_PX = 6;
const unit = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

function savedSpot(): PillSpot | null {
  const raw = getLocal<PillSpot | null>(KEYS.togetherPill, null);
  const x = unit(raw?.x);
  const y = unit(raw?.y);
  return x === null || y === null ? null : { x, y };
}

/**
 * 1.13 — the pill can be dragged anywhere on the screen (it used to sit on
 * top of whatever was in that corner: the lyrics card, on a computer). The
 * spot is kept as a share of the screen, so it is still on screen after the
 * window is resized or the phone is turned. A tap still opens the room.
 */
function useMovable(): {
  spot: PillSpot | null;
  dragging: boolean;
  bind: {
    onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void;
    onClickCapture(e: { preventDefault(): void; stopPropagation(): void }): void;
  };
} {
  const [spot, setSpot] = useState<PillSpot | null>(savedSpot);
  const [dragging, setDragging] = useState(false);
  /** The click that ends a drag is not a tap on the pill. */
  const swallow = useRef(false);
  /** Ends the press in hand, if the pill goes away mid-drag. */
  const release = useRef<(() => void) | null>(null);
  useEffect(() => () => release.current?.(), []);

  return {
    spot,
    dragging,
    bind: {
      onPointerDown: (e) => {
        if (e.button !== 0 || release.current) return;
        const r = e.currentTarget.getBoundingClientRect();
        const id = e.pointerId;
        const from = { x: e.clientX, y: e.clientY };
        let moved = false;
        let latest: PillSpot | null = null;
        // The finger leaves the pill as soon as it moves, so the window is
        // listened to. (Capturing the pointer on the pill would also take the
        // click away from the link inside it: a plain tap would stop opening the room.)
        const move = (ev: PointerEvent): void => {
          if (ev.pointerId !== id) return;
          const dx = ev.clientX - from.x;
          const dy = ev.clientY - from.y;
          if (!moved) {
            if (Math.hypot(dx, dy) < DRAG_START_PX) return;
            moved = true;
            setDragging(true);
          }
          ev.preventDefault();
          // The same sum the stylesheet does (together.css, .vx-lt-pill[data-moved]).
          const roomX = Math.max(1, window.innerWidth - 16 - r.width);
          const roomY = Math.max(1, window.innerHeight - 16 - r.height);
          latest = { x: Math.min(1, Math.max(0, (r.left + dx - 8) / roomX)), y: Math.min(1, Math.max(0, (r.top + dy - 8) / roomY)) };
          setSpot(latest);
        };
        const end = (ev?: PointerEvent): void => {
          if (ev && ev.pointerId !== id) return;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
          release.current = null;
          if (!moved) return;
          setDragging(false);
          if (latest) setLocal(KEYS.togetherPill, latest);
          swallow.current = true;
          // No click follows a drag that ended off the pill: do not swallow the next real tap.
          window.setTimeout(() => (swallow.current = false), 350);
        };
        window.addEventListener('pointermove', move, { passive: false });
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        release.current = () => end();
      },
      onClickCapture: (e) => {
        if (!swallow.current) return;
        swallow.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    },
  };
}

/**
 * 1.13 — reactions rise over the WHOLE screen, on every page, not inside the
 * room's card: the room is felt wherever the listener is in the app. When the
 * room's energy fills, everyone's emoji rain down together for a moment.
 */
function Sky(): ReactNode {
  const floats = useRoom((s) => s.floats);
  const bursting = useRoom((s) => s.bursting);
  if (!floats.length && !bursting) return null;
  return createPortal(
    <div className="vx-lt-sky" aria-hidden>
      {floats.map((f) => (
        <span
          key={f.id}
          className="vx-lt-fly"
          style={{ left: `${f.left}%`, fontSize: `${f.size}px`, animationDuration: `${f.ms}ms`, animationDelay: `${f.delay}ms`, ['--lean' as string]: `${f.lean}px` } as CSSProperties}
        >
          {f.e}
          {f.by && <small className="vx-lt-fly-by">{f.by}</small>}
        </span>
      ))}
      {bursting && <p className="vx-lt-burst">The whole room is feeling it</p>}
    </div>,
    document.body,
  );
}

/**
 * Mounted by AppLayout (lazily) while a Listen Together session is live: runs
 * the sync engine for the whole app and, on every page but /together itself,
 * shows a small "Live" pill — so a host browsing for the next song and a
 * guest reading lyrics both stay in the room and can see that they are.
 */
export default function TogetherController(): ReactNode {
  const mode = useTogether((s) => s.mode);
  const code = useTogether((s) => s.code);
  const status = useTogether((s) => s.status);
  const hostName = useTogether((s) => s.hostName);
  const count = useTogether((s) => s.listenerCount);
  const needsTap = useTogether((s) => s.needsTap);
  const unread = useTogether((s) => s.unread);
  const { pathname } = useLocation();
  const { spot, dragging, bind } = useMovable();

  useEffect(() => {
    if (mode === 'idle' || !code) return;
    return runSession(mode, code);
  }, [mode, code]);

  if (mode === 'idle') return null;
  if (pathname === '/together') return <Sky />;
  // 1.14 — the player's Together tab carries the room (live dot, unread count,
  // chat): the pill would only sit on its Send button. It still comes up there
  // when the browser is holding a guest's audio for a tap.
  if (pathname === '/now-playing' && !needsTap) return <Sky />;

  const label =
    status === 'reconnecting'
      ? 'Reconnecting…'
      : mode === 'host'
        ? `Hosting · ${count} listening`
        : status === 'host-away'
          ? `${hostName ?? 'The host'} went quiet`
          : `Listening with ${hostName ?? 'the host'}`;

  return (
    <>
      <Sky />
      <div
        className="vx-lt-pill"
        data-status={status}
        data-moved={spot ? 'true' : undefined}
        data-dragging={dragging ? 'true' : undefined}
        style={spot ? ({ ['--pill-x' as string]: spot.x, ['--pill-y' as string]: spot.y } as CSSProperties) : undefined}
        role="status"
        title="Drag to move"
        {...bind}
      >
        {needsTap ? (
          <button type="button" className="vx-lt-pill-tap" onClick={tapToListen}>
            <span className="vx-lt-dot" aria-hidden />
            Tap to start listening
          </button>
        ) : (
          <Link
            to="/together"
            className="vx-lt-pill-link"
            draggable={false}
            aria-label={`${label}.${unread ? ` ${unread} new ${unread === 1 ? 'message' : 'messages'}.` : ''} Open Listen Together`}
          >
            <span className="vx-lt-dot" aria-hidden />
            <span className="truncate-1">{label}</span>
            <span className="vx-lt-pill-code">{code}</span>
            {/* 1.14 — new chat lines since a chat was last on screen. */}
            {unread > 0 && (
              <span className="vx-lt-badge" data-testid="lt-unread" aria-hidden>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </Link>
        )}
      </div>
    </>
  );
}
