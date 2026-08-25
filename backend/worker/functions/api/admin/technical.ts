/** Technical Monitoring: version spread, errors, field Web Vitals, lyric coverage. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { dbRpc, dbSelect, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

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
  const [versions, errors, errorsByDay, summary, vitalRows, lyricRows] = await Promise.all([
    dbRpc<VersionRow[]>(env, 'vinax_versions', {}),
    dbRpc<ErrorRow[]>(env, 'vinax_errors', { days, lim: 50 }),
    dbRpc<DayRow[]>(env, 'vinax_errors_by_day', { days: Math.min(days, 30) }),
    dbRpc<Summary>(env, 'vinax_tech_summary', {}),
    dbSelect<VitalEventRow>(
      env,
      'vinax_events',
      `select=error_kind,message&type=eq.vital&created_at=gte.${encodeURIComponent(sinceIso)}&limit=10000`,
    ),
    dbSelect<LyricEventRow>(
      env,
      'vinax_events',
      `select=song_id,song_title,song_artist&type=eq.lyric-miss&created_at=gte.${encodeURIComponent(sinceIso)}&limit=10000`,
    ),
  ]);
  return new Response(
    JSON.stringify({
      days,
      versions: versions ?? [],
      errors: errors ?? [],
      errorsByDay: errorsByDay ?? [],
      summary: summary ?? null,
      vitals: aggregateVitals(vitalRows ?? []),
      lyricMisses: aggregateLyricMisses(lyricRows ?? []),
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
