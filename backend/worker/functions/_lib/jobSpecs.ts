/**
 * The scheduled jobs' list and the owner's choices for them (the `jobs`
 * setting), without the code that runs them (`jobs.ts`). Kept apart so
 * Smart Alerts (`alerts.ts`, which `jobs.ts` runs) can judge the jobs
 * without importing the runner.
 */

export type JobId = 'status-tick' | 'housekeeping' | 'alerts' | 'scheduled-notifications' | 'indexnow' | 'weekly-summary' | 'outreach' | 'ai-model-check';

export interface JobSpec {
  id: JobId;
  label: string;
  /** What the job does, in plain words (the console shows it). */
  about: string;
  /** Default minutes between runs. */
  every: number;
  /** The choices the console offers, in minutes. */
  choices: readonly number[];
}

export const JOBS: readonly JobSpec[] = [
  { id: 'status-tick', label: 'Status check', about: 'Checks that the website, the app and the music sources answer, and records it for the public status page.', every: 30, choices: [30, 60, 180, 360] },
  { id: 'housekeeping', label: 'Clean-up', about: 'Closes empty Listen Together rooms, removes data older than the Data & Privacy periods, and forgets phones that stopped receiving notifications.', every: 60, choices: [60, 180, 360, 720, 1440] },
  // Before the scheduled sends: a large scheduled audience must not spend the run's requests first.
  { id: 'alerts', label: 'Smart Alerts', about: 'Looks for problems (app errors rising, the site not answering, no songs played, new feedback, another job failing, the daily server requests running low) and alerts admins on their phones.', every: 5, choices: [5, 10, 15, 30] },
  { id: 'scheduled-notifications', label: 'Scheduled notifications', about: 'Sends notifications whose scheduled time has come.', every: 5, choices: [5, 15, 30, 60] },
  { id: 'indexnow', label: 'Search engine updates', about: 'Tells Bing and the other IndexNow search engines about new pages on the website, so they are found sooner.', every: 360, choices: [180, 360, 720, 1440] },
  { id: 'weekly-summary', label: 'Weekly summary email', about: 'Every Monday from 9 AM India time, emails the owner last week’s numbers: listening, active and new people, top songs, At risk, errors. Sends once a week; switch the email itself in Notification Rules.', every: 60, choices: [30, 60] },
  { id: 'outreach', label: 'Automatic notifications', about: 'Sends the automatic notifications that are due: the Sunday-evening weekly recap, win-back nudges to regular listeners who went quiet, and new releases from each person’s favourite artists. Each kind has its own switch in Notification Rules; quiet hours and the per-person cap apply.', every: 60, choices: [30, 60, 180] },
  { id: 'ai-model-check', label: 'VinaX AI model check', about: 'Once a day, sends one tiny message to each paused VinaX AI model. One that answers quickly is back in the model menu (picked by hand only, never in Auto); one that fails stays paused.', every: 1440, choices: [720, 1440] },
] as const;

/** One `job_runs` row, as much of it as the runner and Smart Alerts read. */
export interface RecentRun { started_at: string; ok: boolean | null; summary?: unknown }
/** Each job's newest runs, newest first. */
export type RecentRuns = Map<JobId, RecentRun[]>;

/** The owner's choices for one job, after checking them. */
export interface JobSetting { enabled: boolean; every: number }

/** The `jobs` setting for every job, with defaults and only allowed values. */
export function jobSettings(raw: unknown): Record<JobId, JobSetting> {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<JobId, JobSetting>;
  for (const j of JOBS) {
    const v = src[j.id] && typeof src[j.id] === 'object' ? (src[j.id] as Record<string, unknown>) : {};
    const every = typeof v.every === 'number' && j.choices.includes(v.every) ? v.every : j.every;
    out[j.id] = { enabled: v.enabled !== false, every };
  }
  return out;
}

/** Minutes after which a job with no newer run counts as late. */
export const lateAfter = (every: number): number => Math.max(every * 2 + 15, 45);

/** What `runScheduled` already knows about every job, handed to Smart Alerts so it reads nothing again. */
export interface JobContext { recentRuns: RecentRuns; settings: Record<JobId, JobSetting> }

/** Is the job due: on, and its last run started `every` minutes ago or more (2 minutes' grace). */
export function isDue(cfg: JobSetting, lastStartedAt: string | null, at: number): boolean {
  if (!cfg.enabled) return false;
  if (!lastStartedAt) return true;
  const age = (at - Date.parse(lastStartedAt)) / 60_000;
  return !Number.isFinite(age) || age >= cfg.every - 2;
}

export const isJobId = (v: unknown): v is JobId => JOBS.some((j) => j.id === v);

/**
 * Is the job late: switched on, it has run before, and its last run started
 * more than `lateAfter(every)` minutes ago. The Scheduled Jobs page shows it
 * as "running late"; Smart Alerts' jobsFailing alerts on it.
 */
export function isOverdue(cfg: JobSetting, lastStartedAt: string | null, now: number): boolean {
  if (!cfg.enabled || !lastStartedAt) return false;
  const age = (now - Date.parse(lastStartedAt)) / 60_000;
  return Number.isFinite(age) && age > lateAfter(cfg.every);
}
