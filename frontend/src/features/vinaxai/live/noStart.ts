/**
 * VinaX AI Live voice — Live models that would not start on this device.
 *
 * A model Gemini refuses (it closes the socket before setupComplete, with
 * and without the speed settings) is remembered for 12 hours and skipped
 * when Live voice opens, so the listener doesn't wait about five seconds
 * for it every time (Gemini 3.8 Live with Extended thinking never started
 * on VinaX's key, 2026-11-05). A model that starts is forgotten at once;
 * a timeout (a slow network, not a refusal) is never remembered.
 *
 * Browser storage is a convenience only: when it can't be read, nothing is
 * skipped and Live voice works as before.
 */
const KEY = 'vinax.live.noStart.v1';
export const NO_START_MS = 12 * 60 * 60_000;

function read(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])));
  } catch {
    return {};
  }
}

function write(v: Record<string, number>): void {
  try {
    if (Object.keys(v).length) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked: nothing is remembered */ }
}

/** The Live models to skip now (their 12 hours not over). */
export function noStartModels(now = Date.now()): string[] {
  return Object.entries(read()).filter(([, until]) => until > now).map(([id]) => id).slice(0, 10);
}

export function rememberNoStart(id: string, now = Date.now()): void {
  const v = read();
  for (const [k, until] of Object.entries(v)) if (until <= now) delete v[k];
  v[id] = now + NO_START_MS;
  write(v);
}

export function forgetNoStart(id?: string): void {
  if (id === undefined) { write({}); return; }
  const v = read();
  if (!(id in v)) return;
  delete v[id];
  write(v);
}
