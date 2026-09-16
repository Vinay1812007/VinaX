import { KEYS } from '@/constants/storage-keys';
import { getLocal, removeLocal, setLocal } from '@/services/storage/local';
import { installId } from '@/services/identity/installId';
import { isNativePlatform } from '@/services/native';

/**
 * Username claim state machine.
 *
 * A handle is only CONFIRMED once the service says so. Before this module,
 * a network hiccup during onboarding stored the handle as if it were
 * confirmed, so the listener saw "@name" everywhere while the service had
 * no idea — and, because the local copy existed, the app never asked again.
 *
 *   claimHandle()          → confirmed | taken | pending
 *   pendingClaim()         → the claim still waiting (with why), or null
 *   retryPendingClaim()    → re-sends a pending claim (called on reconnect)
 *   handleStatus()         → what to show: confirmed / pending / taken / none
 */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/username' : '/api/username';

export interface PendingClaim {
  username: string;
  name: string;
  /** When the listener chose it. */
  since: number;
  /** 'pending' — never confirmed yet; 'taken' — the service refused it, pick another. */
  status: 'pending' | 'taken';
  suggestions?: string[];
  /** Last attempt, so the UI can say "tried 2 min ago". */
  lastTry?: number;
}

export type ClaimOutcome =
  | { status: 'confirmed'; username: string }
  | { status: 'taken'; username: string; suggestions: string[] }
  | { status: 'pending'; username: string; reason: 'offline' | 'server' };

export function pendingClaim(): PendingClaim | null {
  const p = getLocal<PendingClaim | null>(KEYS.userHandlePending, null);
  if (!p || typeof p !== 'object' || typeof p.username !== 'string' || !USERNAME_RE.test(p.username)) return null;
  return { ...p, status: p.status === 'taken' ? 'taken' : 'pending', name: typeof p.name === 'string' ? p.name : '' };
}

export function confirmedHandle(): string | null {
  const h = getLocal<string>(KEYS.userHandle, '');
  return USERNAME_RE.test(h) ? h : null;
}

export type HandleStatus =
  | { state: 'confirmed'; handle: string }
  | { state: 'pending'; handle: string; since: number }
  | { state: 'taken'; handle: string; suggestions: string[] }
  | { state: 'none' };

export function handleStatus(): HandleStatus {
  const confirmed = confirmedHandle();
  if (confirmed) return { state: 'confirmed', handle: confirmed };
  const p = pendingClaim();
  if (!p) return { state: 'none' };
  if (p.status === 'taken') return { state: 'taken', handle: p.username, suggestions: p.suggestions ?? [] };
  return { state: 'pending', handle: p.username, since: p.since };
}

interface ClaimReply {
  ok?: boolean;
  unchecked?: boolean;
  username?: string;
  signed_device_id_next?: string;
  error?: string;
  suggestions?: string[];
}

/**
 * Claim `username` for this device. Stores the handle as confirmed only on a
 * 2xx `ok`; a 409 reports `taken`; anything else (offline, 5xx, malformed
 * reply) parks the claim as PENDING so it can be retried and the UI can say
 * so truthfully.
 */
export async function claimHandle(username: string, name: string): Promise<ClaimOutcome> {
  const u = username.trim().toLowerCase();
  const park = (reason: 'offline' | 'server'): ClaimOutcome => {
    const prev = pendingClaim();
    setLocal<PendingClaim>(KEYS.userHandlePending, {
      username: u,
      name,
      since: prev?.username === u ? prev.since : Date.now(),
      status: 'pending',
      lastTry: Date.now(),
    });
    return { status: 'pending', username: u, reason };
  };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return park('offline');
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: u,
        name,
        signed_device_id: getLocal<string>(KEYS.signedDeviceId, '') || undefined,
        deviceId: installId(),
        current_username: confirmedHandle() ?? undefined,
      }),
    });
    if (res.status === 409) {
      const j = (await res.json().catch(() => null)) as ClaimReply | null;
      const suggestions = Array.isArray(j?.suggestions) ? j.suggestions.filter((s): s is string => typeof s === 'string') : [];
      // Keep the listener's choice on record as refused so the app asks again.
      setLocal<PendingClaim>(KEYS.userHandlePending, { username: u, name, since: Date.now(), status: 'taken', suggestions, lastTry: Date.now() });
      return { status: 'taken', username: u, suggestions };
    }
    if (!res.ok) return park('server');
    const j = (await res.json().catch(() => null)) as ClaimReply | null;
    if (!j?.ok) return park('server');
    if (j.signed_device_id_next) setLocal(KEYS.signedDeviceId, j.signed_device_id_next);
    const saved = typeof j.username === 'string' && USERNAME_RE.test(j.username) ? j.username : u;
    setLocal(KEYS.userHandle, saved);
    removeLocal(KEYS.userHandlePending);
    return { status: 'confirmed', username: saved };
  } catch {
    return park('offline');
  }
}

/** Forget a refused/pending choice (the listener is picking a new one). */
export function clearPendingClaim(): void {
  removeLocal(KEYS.userHandlePending);
}

let retrying: Promise<ClaimOutcome | null> | null = null;

/** Re-send a parked claim, if any. Concurrent calls share one request. */
export function retryPendingClaim(): Promise<ClaimOutcome | null> {
  if (retrying) return retrying;
  const p = pendingClaim();
  if (!p || p.status !== 'pending' || confirmedHandle()) return Promise.resolve(null);
  retrying = claimHandle(p.username, p.name).finally(() => {
    retrying = null;
  });
  return retrying;
}

/**
 * Retry a parked claim now and whenever the device comes back online.
 * Returns a teardown. Safe to call once per app boot.
 */
export function installClaimRetry(): () => void {
  const tick = (): void => {
    void retryPendingClaim();
  };
  if (pendingClaim()?.status === 'pending') tick();
  window.addEventListener('online', tick);
  return () => window.removeEventListener('online', tick);
}
