import { useHistoryStore } from '@/store/historyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { minutesToday } from '@/features/home/onThisDay';

/**
 * v5.12.0 — daily listening goal. A ring that fills through the day, computed
 * from on-device history only. Renders nothing when no goal is set.
 */
export function GoalRing({ compact = false }: { compact?: boolean }) {
  const goal = useSettingsStore((s) => s.dailyGoalMinutes);
  const entries = useHistoryStore((s) => s.entries);
  if (!goal) return null;
  const mins = minutesToday(entries);
  const pct = Math.min(100, Math.round((mins / goal) * 100));
  const r = compact ? 16 : 26;
  const c = 2 * Math.PI * r;
  const size = compact ? 40 : 64;
  return (
    <div className={compact ? 'flex items-center gap-2' : 'rounded-xl bg-ink-850 p-4 flex items-center gap-4'}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--ink-100) / 0.1)" strokeWidth={compact ? 4 : 6} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(var(--ember-500))"
          strokeWidth={compact ? 4 : 6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="min-w-0">
        <p className={compact ? 'text-[12px] font-bold leading-tight tabular-nums' : 'text-[15px] font-bold tabular-nums'}>
          {pct >= 100 ? 'Goal reached' : `${mins} of ${goal} min today`}
        </p>
        {!compact && <p className="mt-0.5 text-[13px] font-medium text-ink-400 tabular-nums">Daily listening goal · {pct}%</p>}
      </div>
    </div>
  );
}
