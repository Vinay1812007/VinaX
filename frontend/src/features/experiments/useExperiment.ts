/**
 * Package E2 — the client half of A/B experiments.
 *
 *   const variant = useExperiment('home-density'); // 'control' | 'compact' | …
 *
 * Assignment is deterministic and sticky with ZERO server round-trips per
 * decision: FNV-1a over "deviceId:key" → bucket 0-99 → the experiment's
 * cumulative variant splits. The IDENTICAL algorithm lives in
 * functions/_lib/experiments.ts, which is how the admin dashboard computes
 * per-variant metrics from plain play events — no experiment tag ever rides
 * an event, nothing extra is sent. Config comes from the anonymous, cacheable
 * /api/experiments (same trust shape as the blocklist).
 *
 * Cold behavior: until config arrives (or when the experiment is absent,
 * paused, or the bucket falls outside allocated traffic) the hook returns
 * 'control' — a surface using it must treat 'control' as today's behavior.
 * This module costs nothing until the first surface imports it.
 */
import { useEffect, useState } from 'react';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { isNativePlatform, platformName } from '@/services/native';

interface Variant {
  name: string;
  pct: number;
}
/** Console rebuild — who a test includes (set on the owner console's A/B Tests page). */
export interface ExperimentAudience {
  platform?: 'all' | 'android' | 'web' | 'ios';
  minVersion?: string | null;
  percent?: number;
}
interface Experiment {
  key: string;
  variants: Variant[];
  audience?: ExperimentAudience | null;
}

const ENDPOINT = isNativePlatform() ? 'https://www.vinaxmusic.online/api/experiments' : '/api/experiments';

// --- deterministic assignment (mirror of functions/_lib/experiments.ts) ----
function fnv1a(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function pickVariant(deviceId: string, key: string, variants: Variant[]): string | null {
  if (!deviceId || !variants.length) return null;
  const b = fnv1a(`${deviceId}:${key}`) % 100;
  let acc = 0;
  for (const v of variants) {
    acc += Math.max(0, Math.floor(v.pct));
    if (b < acc) return v.name;
  }
  return null;
}

// --- who is included (mirror of inAudience in functions/_lib/experiments.ts) --
function compareVersions(a: string, b: string): number {
  const x = a.split('.').map((n) => Number(n) || 0);
  const y = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** This device's platform and app version, as the console's targeting reads them. */
export function deviceFacts(): { platform: string; version: string } {
  let platform = 'web';
  try {
    platform = platformName() || 'web';
  } catch {
    /* web */
  }
  return { platform, version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '' };
}

/**
 * Is the device in the test's audience? Platform must match (unless 'all'),
 * the app must be at least `minVersion`, and a second hash over
 * "deviceId:key:in" must fall under `percent` — so raising the percent adds
 * people without moving anyone already in. No audience = everyone.
 */
export function inAudience(
  deviceId: string,
  key: string,
  audience: ExperimentAudience | null | undefined,
  device: { platform?: string | null; version?: string | null } = deviceFacts(),
): boolean {
  if (!audience) return true;
  const platform = audience.platform === 'android' || audience.platform === 'web' || audience.platform === 'ios' ? audience.platform : 'all';
  if (platform !== 'all' && device.platform !== platform) return false;
  const min = typeof audience.minVersion === 'string' && /^\d{1,4}(\.\d{1,4}){0,3}$/.test(audience.minVersion) ? audience.minVersion : null;
  if (min && (!device.version || compareVersions(device.version, min) < 0)) return false;
  const pct = Number.isFinite(Number(audience.percent)) ? Math.max(0, Math.min(100, Math.round(Number(audience.percent)))) : 100;
  if (pct >= 100) return true;
  return fnv1a(`${deviceId}:${key}:in`) % 100 < pct;
}

/** The device's variant, with the audience applied first (null = not in the test). */
export function variantFor(deviceId: string, exp: Experiment): string | null {
  return inAudience(deviceId, exp.key, exp.audience) ? pickVariant(deviceId, exp.key, exp.variants) : null;
}

// --- config, fetched once per session ---------------------------------------
let configPromise: Promise<Map<string, Experiment>> | null = null;

function loadConfig(): Promise<Map<string, Experiment>> {
  if (!configPromise) {
    configPromise = fetch(ENDPOINT, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ experiments?: Experiment[] }>) : { experiments: [] }))
      .then((d) => new Map((d.experiments ?? []).map((e) => [e.key, e])))
      .catch(() => new Map<string, Experiment>());
  }
  return configPromise;
}

function deviceId(): string {
  let id = getLocal<string>(KEYS.deviceId, '');
  if (!id) {
    id =
      globalThis.crypto && 'randomUUID' in globalThis.crypto
        ? globalThis.crypto.randomUUID()
        : `g_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setLocal(KEYS.deviceId, id);
  }
  return id;
}

/** The device's variant for `key`, or 'control' until config resolves / when
 *  the device isn't in the experiment. Stable across renders and sessions. */
export function useExperiment(key: string): string {
  const [variant, setVariant] = useState('control');
  useEffect(() => {
    let alive = true;
    void loadConfig().then((map) => {
      if (!alive) return;
      const exp = map.get(key);
      const v = exp ? variantFor(deviceId(), exp) : null;
      if (v) setVariant(v);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return variant;
}
