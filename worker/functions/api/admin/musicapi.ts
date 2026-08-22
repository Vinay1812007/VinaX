/**
 * Live health check for the upstream JioSaavn API mirrors the app streams
 * from. Pings each mirror's search endpoint server-side (no browser CORS
 * variance) and reports status + latency + whether it returned songs, so a
 * silent-empty-home has an obvious cause in the dashboard. Admin-gated: the
 * mirrors are community services and this spends their quota.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';

type Env = AdminEnv;

const MIRRORS = [
  { id: 'saavn-sumit', label: 'saavn.sumit.co', base: 'https://saavn.sumit.co/api' },
  { id: 'saavn-dev', label: 'saavn.dev', base: 'https://saavn.dev/api' },
  { id: 'nepotune', label: 'nepotuneapi.vercel.app', base: 'https://nepotuneapi.vercel.app/api' },
  { id: 'b4a', label: 'jiosaavn-api-privatecv8.b4a.run', base: 'https://jiosaavn-api-privatecv8.b4a.run/api' },
] as const;

interface MirrorHealth {
  id: string;
  label: string;
  base: string;
  ok: boolean;
  status: number | null;
  ms: number;
  songs: number;
  note: string | null;
}

async function pingMirror(m: (typeof MIRRORS)[number]): Promise<MirrorHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const t0 = Date.now();
  try {
    const res = await fetch(`${m.base}/search/songs?query=telugu&limit=1`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const ms = Date.now() - t0;
    let songs = 0;
    let parsed = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const j: any = await res.json();
      parsed = true;
      const results = j?.data?.results ?? j?.results;
      if (Array.isArray(results)) songs = results.length;
    } catch {
      /* non-JSON body (rate-limit HTML etc.) */
    }
    const ok = res.ok && parsed;
    // Sanitized note only — never echo upstream bodies (see audit M-SRV-5).
    const note = ok ? null : res.ok ? 'non-json body' : `http ${res.status}`;
    return { id: m.id, label: m.label, base: m.base, ok, status: res.status, ms, songs, note };
  } catch {
    return {
      id: m.id, label: m.label, base: m.base,
      ok: false, status: null, ms: Date.now() - t0, songs: 0,
      note: 'network / timeout',
    };
  } finally {
    clearTimeout(timer);
  }
}

export const onRequestGet = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const mirrors = await Promise.all(MIRRORS.map(pingMirror));
  return new Response(JSON.stringify({ checkedAt: new Date().toISOString(), mirrors }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
