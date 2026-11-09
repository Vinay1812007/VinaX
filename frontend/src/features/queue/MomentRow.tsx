import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { useHistoryStore } from '@/store/historyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { momentLine, momentProfile } from '@/services/personalization/moments';

/**
 * 1.12 — one quiet line on the Queue page: the moment Up Next is planning
 * for and what this listener usually plays then ("Weekday evenings you play
 * Sid Sriram and Anirudh, mostly Telugu"). Nothing when the pattern is thin
 * or the awareness is off.
 */
export function MomentRow() {
  const aware = useSettingsStore((s) => s.momentAware);
  const entries = useHistoryStore((s) => s.entries);
  const line = useMemo(() => (aware === false ? null : momentLine(momentProfile(entries, new Date()))), [aware, entries]);
  if (!line) return null;
  return (
    <div className="vx-queue-toolrow" data-testid="queue-moment">
      <span className="vx-queue-toolrow-label" aria-hidden>Moment</span>
      <p className="text-meta text-ink-300 py-1 m-0">
        {line}. Up Next and the AI DJ lean that way. <Link to="/settings#recommendations" className="underline">Change</Link>
      </p>
    </div>
  );
}
