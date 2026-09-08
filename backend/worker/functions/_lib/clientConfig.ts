/**
 * v5.15.0 — the admin-published config keys that the app itself reads, and
 * the ONE public bundle that ships them (GET /api/appconfig?key=client).
 *
 * Every value here is written by the admin console into `vinax_config` and
 * sanitised again on the way out, so a bad row can never break listeners:
 * unknown fields are dropped, strings are clipped, lists are capped.
 */
import { sbSelect, supabaseConfigured, type SupabaseEnv } from './supabase';

export const CLIENT_KEYS = [
  'greeting', 'broadcast', 'search-synonyms', 'catalog-sources', 'language-order',
  'ai-starters', 'ai-quick', 'support-faq', 'min-version', 'maintenance-window',
] as const;

interface ConfigRow { key: string; value: unknown }

const memo = new Map<string, { at: number; value: Record<string, unknown> }>();
const TTL = 60_000;

/** Read several config keys in one query, memoised per isolate for a minute. */
export async function readConfig(env: SupabaseEnv, keys: readonly string[]): Promise<Record<string, unknown>> {
  if (!supabaseConfigured(env)) return {};
  const id = keys.join(',');
  const hit = memo.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const list = keys.map((k) => `"${k}"`).join(',');
  const rows = await sbSelect<ConfigRow>(env, 'vinax_config', `key=in.(${encodeURIComponent(list)})&select=key,value`).catch(() => [] as ConfigRow[]);
  const value: Record<string, unknown> = {};
  for (const r of rows) value[r.key] = r.value;
  memo.set(id, { at: Date.now(), value });
  return value;
}

/** Test hook. */
export function resetConfigMemo(): void { memo.clear(); }

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// Quick-action prompts keep their trailing space on purpose ("Write a ").
const strRaw = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const inWindow = (start: unknown, end: unknown, now: Date): boolean => {
  const s = typeof start === 'string' && start ? Date.parse(start) : NaN;
  const e = typeof end === 'string' && end ? Date.parse(end) : NaN;
  if (!Number.isNaN(s) && now.getTime() < s) return false;
  if (!Number.isNaN(e) && now.getTime() > e) return false;
  return true;
};
const SLUG = /^[a-z][a-z0-9_-]{0,39}$/;

export interface ClientConfig {
  greeting: { text: string } | null;
  broadcast: { id: string; text: string; link?: string } | null;
  synonyms: Record<string, string>;
  disabledSources: string[];
  languageOrder: string[];
  aiStarters: string[];
  aiQuick: Array<{ icon: string; label: string; prompt: string; mode?: string }>;
  faq: Array<{ q: string; a: string }>;
  minBuild: number | null;
}

/** The safe, public shape — what listeners' apps actually receive. */
export function publicClientConfig(raw: Record<string, unknown>, now = new Date()): ClientConfig {
  const g = obj(raw['greeting']);
  const greeting = g && str(g.text, 160) && inWindow(g.start, g.end, now) ? { text: str(g.text, 160) } : null;

  const b = obj(raw['broadcast']);
  const broadcast = b && str(b.id, 40) && str(b.text, 240) && inWindow(b.start, b.end, now)
    ? { id: str(b.id, 40), text: str(b.text, 240), ...(str(b.link, 200).startsWith('/') ? { link: str(b.link, 200) } : {}) }
    : null;

  const synonyms: Record<string, string> = {};
  const syn = obj(raw['search-synonyms']);
  if (syn) {
    for (const [k, v] of Object.entries(syn)) {
      const from = k.trim().toLowerCase().slice(0, 60);
      const to = str(v, 80);
      if (from && to && from !== to.toLowerCase()) synonyms[from] = to;
      if (Object.keys(synonyms).length >= 200) break;
    }
  }

  const cs = obj(raw['catalog-sources']);
  const disabledSources = cs ? Object.entries(cs).filter(([k, v]) => v === false && SLUG.test(k)).map(([k]) => k).slice(0, 20) : [];

  const lo = raw['language-order'];
  const languageOrder = Array.isArray(lo) ? (lo as unknown[]).filter((x): x is string => typeof x === 'string' && SLUG.test(x)).slice(0, 20) : [];

  const st = raw['ai-starters'];
  const aiStarters = Array.isArray(st) ? (st as unknown[]).map((x) => str(x, 160)).filter(Boolean).slice(0, 24) : [];

  const qa = raw['ai-quick'];
  const aiQuick = Array.isArray(qa)
    ? (qa as unknown[]).map(obj).filter((x): x is Record<string, unknown> => !!x)
      .map((x) => ({ icon: str(x.icon, 4), label: str(x.label, 20), prompt: strRaw(x.prompt, 200), ...(SLUG.test(str(x.mode, 20)) ? { mode: str(x.mode, 20) } : {}) }))
      .filter((x) => x.label && x.prompt.trim()).slice(0, 8)
    : [];

  const fq = raw['support-faq'];
  const faq = Array.isArray(fq)
    ? (fq as unknown[]).map(obj).filter((x): x is Record<string, unknown> => !!x)
      .map((x) => ({ q: str(x.q, 160), a: str(x.a, 1200) })).filter((x) => x.q && x.a).slice(0, 30)
    : [];

  const mv = obj(raw['min-version']);
  const minBuild = mv && Number.isInteger(mv.build) && (mv.build as number) > 0 ? (mv.build as number) : null;

  return { greeting, broadcast, synonyms, disabledSources, languageOrder, aiStarters, aiQuick, faq, minBuild };
}

/** Maintenance window: { start, end, note } in ISO; active when now is inside. */
export function maintenanceActive(raw: unknown, now = new Date()): { note: string } | null {
  const m = obj(raw);
  if (!m) return null;
  const s = typeof m.start === 'string' ? Date.parse(m.start) : NaN;
  const e = typeof m.end === 'string' ? Date.parse(m.end) : NaN;
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  const t = now.getTime();
  return t >= s && t <= e ? { note: str(m.note, 200) } : null;
}

/** House rules for the assistant: plain text lines the team appends to the
 *  system prompt (a promo, a correction, a tone note). Clipped hard. */
export function houseRules(raw: unknown): string {
  const s = str(raw, 1200);
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 32 || ch === '\n' || ch === '\t') out += ch;
  }
  return out;
}
