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
import { isNativePlatform } from '@/services/native';

interface Variant {
  name: string;
  pct: number;
}
interface Experiment {
  key: string;
  variants: Variant[];
}

const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/experiments' : '/api/experiments';

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
      const v = exp ? pickVariant(deviceId(), key, exp.variants) : null;
      if (v) setVariant(v);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return variant;
}
