/** Technical Monitoring: version spread, errors, field Web Vitals, lyric coverage. */
import { adminJson, dbFailure, isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpcResult, sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

function clampDays(v: string | null): number {
  const n = parseInt(v ?? '7', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 90) : 7;
}

interface VersionRow { app_version: string; platform: string; users: number; }
interface ErrorRow { error_kind: string; message: string; hits: number; last_seen: string; }
interface DayRow { day: string; hits: number; }
interface Summary { errors_24h: number; plays_24h: number; active_sessions: number; versions: number; }
interface VitalEventRow { error_kind: string | null; message: string | null; }
interface LyricEventRow { song_id: string | null; song_title: string | null; song_artist: string | null; }

interface VitalStat { metric: string; p75: number | null; unit: string; good: number; ni: number; poor: number; count: number; }

function p75(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.75))];
}

/** Client reports vitals as "1234ms good /path" (LCP/INP) or "0.052 good /path" (CLS). */
function aggregateVitals(rows: VitalEventRow[]): VitalStat[] {
  const acc: Record<string, { values: number[]; good: number; ni: number; poor: number }> = {};
  for (const r of rows) {
    const name = (r.error_kind ?? '').toUpperCase();
    if (name !== 'LCP' && name !== 'INP' && name !== 'CLS') continue;
    const msg = String(r.message ?? '');
    const value = parseFloat(msg);
    if (!Number.isFinite(value)) continue;
    let a = acc[name];
    if (!a) {
      a = { values: [], good: 0, ni: 0, poor: 0 };
      acc[name] = a;
    }
    a.values.push(value);
    if (msg.includes(' good')) a.good += 1;
    else if (msg.includes(' poor')) a.poor += 1;
    else a.ni += 1;
  }
  return ['LCP', 'INP', 'CLS'].map((m) => {
    const a = acc[m] ?? { values: [], good: 0, ni: 0, poor: 0 };
    const v = p75(a.values);
    return {
      metric: m,
      p75: v == null ? null : m === 'CLS' ? Math.round(v * 1000) / 1000 : Math.round(v),
      unit: m === 'CLS' ? '' : 'ms',
      good: a.good,
      ni: a.ni,
      poor: a.poor,
      count: a.values.length,
    };
  });
}

function aggregateLyricMisses(
  rows: LyricEventRow[],
): Array<{ song_id: string | null; song_title: string; song_artist: string | null; hits: number }> {
  const map = new Map<string, { song_id: string | null; song_title: string; song_artist: string | null; hits: number }>();
  for (const r of rows) {
    const key = r.song_id ?? r.song_title ?? '';
    if (!key) continue;
    const cur = map.get(key);
    if (cur) cur.hits += 1;
    else map.set(key, { song_id: r.song_id, song_title: r.song_title ?? 'Unknown', song_artist: r.song_artist ?? null, hits: 1 });
  }
  return [...map.values()].sort((a, b) => b.hits - a.hits).slice(0, 15);
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const days = clampDays(new URL(request.url).searchParams.get('days'));
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  if (!supabaseConfigured(env)) {
    return adminJson({ configured: false, days, versions: [], errors: [], errorsByDay: [], summary: null, vitals: aggregateVitals([]), lyricMisses: [] });
  }
  const [versions, errors, errorsByDay, summary, vitalRows, lyricRows] = await Promise.all([
    sbRpcResult<VersionRow[]>(env, 'vinax_versions', {}),
    sbRpcResult<ErrorRow[]>(env, 'vinax_errors', { days, lim: 50 }),
    sbRpcResult<DayRow[]>(env, 'vinax_errors_by_day', { days: Math.min(days, 30) }),
    sbRpcResult<Summary>(env, 'vinax_tech_summary', {}),
    sbSelectResult<VitalEventRow>(
      env,
      'vinax_events',
      `select=error_kind,message&type=eq.vital&created_at=gte.${encodeURIComponent(sinceIso)}&limit=10000`,
    ),
    sbSelectResult<LyricEventRow>(
      env,
      'vinax_events',
      `select=song_id,song_title,song_artist&type=eq.lyric-miss&created_at=gte.${encodeURIComponent(sinceIso)}&limit=10000`,
    ),
  ]);
  // 7.2.0 — this panel also hosts the maintenance tools and the live health
  // check (the first place to look during a database outage), so its six
  // independent parts degrade one by one: a failed part is null (never 0 or
  // an empty list) and is named in `unavailable`. Only when every part failed
  // does the route answer 502.
  const parts = { versions, errors, errorsByDay, summary, vitals: vitalRows, lyricMisses: lyricRows };
  const unavailable = Object.entries(parts).filter(([, r]) => !r.ok).map(([name]) => name);
  if (unavailable.length === Object.keys(parts).length) {
    const first = [versions, errors, errorsByDay, summary, vitalRows, lyricRows].find((r) => !r.ok);
    if (first && !first.ok) return dbFailure(first, { unavailable });
  }
  return adminJson({
    configured: true,
    days,
    versions: versions.ok ? (versions.value ?? []) : null,
    errors: errors.ok ? (errors.value ?? []) : null,
    errorsByDay: errorsByDay.ok ? (errorsByDay.value ?? []) : null,
    summary: summary.ok ? (summary.value ?? null) : null,
    vitals: vitalRows.ok ? aggregateVitals(vitalRows.rows) : null,
    lyricMisses: lyricRows.ok ? aggregateLyricMisses(lyricRows.rows) : null,
    unavailable,
  });
};
