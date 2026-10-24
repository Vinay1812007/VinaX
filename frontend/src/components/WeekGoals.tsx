import { useMemo } from 'react';
import { useHistoryStore } from '@/store/historyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { weekGoals } from '@/features/stats/goals';

/**
 * 15.0 — the weekly goals on the Stats page: a meter each, the streak of
 * weeks met, and the days left. Renders nothing while both goals are off.
 */
export function WeekGoals() {
  const minutes = useSettingsStore((s) => s.weeklyGoalMinutes);
  const artists = useSettingsStore((s) => s.weeklyGoalArtists);
  const entries = useHistoryStore((s) => s.entries);
  const goals = useMemo(() => weekGoals(entries, { minutes, artists }), [entries, minutes, artists]);
  if (!goals.length) return null;
  return (
    <ul className="vx-weekgoals" aria-label="Weekly goals">
      {goals.map((g) => {
        const label = g.kind === 'minutes' ? 'Minutes this week' : 'New artists this week';
        const value = g.kind === 'minutes' ? `${g.value} of ${g.goal} min` : `${g.value} of ${g.goal}`;
        return (
          <li key={g.kind} className="vx-weekgoal">
            <div className="vx-weekgoal-head">
              <span className="vx-weekgoal-label">{label}</span>
              <span className="vx-weekgoal-value tabular-nums">{g.met ? 'Done' : value}</span>
            </div>
            <div className="vx-weekgoal-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.pct} aria-label={label}>
              <span style={{ width: `${Math.max(4, g.pct)}%` }} />
            </div>
            <p className="vx-weekgoal-sub">
              {g.streak > 0 ? `${g.streak}-week streak` : 'No streak yet'}
              {' · '}
              {g.met ? 'met this week' : `${g.daysLeft} day${g.daysLeft === 1 ? '' : 's'} left`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
