/** Screen Wake Lock — keeps the display on while the full-screen player is
 * open and music is playing. No-ops where unsupported. */
interface WakeLockSentinelLike {
  release(): Promise<void>;
}

let sentinel: WakeLockSentinelLike | null = null;

export async function acquireWakeLock(): Promise<void> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock || sentinel) return;
    sentinel = await nav.wakeLock.request('screen');
  } catch {
    sentinel = null;
  }
}

export function releaseWakeLock(): void {
  void sentinel?.release().catch(() => undefined);
  sentinel = null;
}
