/**
 * 13.9 — who listens on what: signed-in accounts and listener devices split by
 * platform, for the console's Overview and Listeners pages.
 *
 * Two sources, like the Listeners page itself:
 *  - `vinax_accounts.platform` (13.7): written at sign-in and on the session
 *    check for every Google account, whether or not usage sharing is on. This
 *    is the half that used to be invisible — a listener on Android or the web
 *    who never ticked "share usage" appeared nowhere in a platform chart.
 *  - `vinax_users.platform` through the `vinax_platforms()` function: listener
 *    devices that share usage (opt-in).
 *
 * Exact counts (`Prefer: count=exact`), never an estimate; a half that cannot
 * be read is `null`, never zero, so the console can say "unavailable".
 */
import { sbCountResult, sbRpcResult, type SupabaseEnv } from './supabase';

/** The platforms the app reports (services/native platformName). */
export const PLATFORMS = ['web', 'android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface PlatformSplit {
  web: number;
  android: number;
  ios: number;
  /** Rows whose platform is empty: accounts from before 13.7 that have not signed in since. */
  other: number;
  total: number;
}

export interface Platforms {
  /** Every signed-in account, linked to a usage row or not. */
  accounts: PlatformSplit | null;
  /** Accounts with no linked usage row: the "account only" rows of the Listeners page. */
  accountsOnly: PlatformSplit | null;
  /** Listener devices sharing usage (all time), from vinax_platforms(). */
  devices: Array<{ platform: string; listeners: number }> | null;
}

/** `?platform=` as the routes accept it: a known platform, or '' for all. */
export function platformParam(raw: string | null): Platform | '' {
  const v = (raw ?? '').trim().toLowerCase();
  return (PLATFORMS as readonly string[]).includes(v) ? (v as Platform) : '';
}

async function splitOf(env: SupabaseEnv, table: string, where: string): Promise<PlatformSplit | null> {
  const and = where ? `${where}&` : '';
  const [web, android, ios, total] = await Promise.all([
    sbCountResult(env, table, `${and}platform=eq.web`),
    sbCountResult(env, table, `${and}platform=eq.android`),
    sbCountResult(env, table, `${and}platform=eq.ios`),
    sbCountResult(env, table, where),
  ]);
  if (!web.ok || !android.ok || !ios.ok || !total.ok) return null;
  return {
    web: web.value,
    android: android.value,
    ios: ios.value,
    other: Math.max(0, total.value - web.value - android.value - ios.value),
    total: total.value,
  };
}

export async function readPlatforms(env: SupabaseEnv): Promise<Platforms> {
  const [accounts, accountsOnly, devices] = await Promise.all([
    splitOf(env, 'vinax_accounts', ''),
    splitOf(env, 'vinax_accounts', 'device_id=is.null'),
    sbRpcResult<Array<{ platform: string | null; listeners: number | string }> | null>(env, 'vinax_platforms', {}),
  ]);
  return {
    accounts,
    accountsOnly,
    devices: devices.ok
      ? (devices.value ?? []).map((r) => ({ platform: (r.platform ?? 'web').toLowerCase(), listeners: Number(r.listeners) || 0 }))
      : null,
  };
}
