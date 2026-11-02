/**
 * Console rebuild — the owner console's Home Screen and App Updates choices, as
 * plain functions the components call (and tests pin):
 *   greetingLine      the Home greeting for this part of the day, with the first name
 *   compareVersions   "1.8.10" vs "1.8.9"
 *   versionVerdict    is this install older than the owner allows, and must it update
 *   announcementDue   should the pop-up announcement show now
 */
import type { Greeting, VersionPolicy } from '@/features/home/useAppConfig';

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

/** 5–11 morning, 12–16 afternoon, 17–20 evening, otherwise night (the device's own clock). */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/** The greeting to show, or '' when there is none. */
export function greetingLine(g: Greeting | null | undefined, name: string | null | undefined, now = new Date()): string {
  if (!g) return '';
  const part = dayPart(now.getHours());
  const text = (g.parts ? g.parts[part] : undefined) ?? (g.parts ? '' : g.text);
  if (!text) return '';
  const first = (name ?? '').trim().split(/\s+/)[0];
  return g.withName && first ? `Hi ${first}! ${text}` : text;
}

/** Negative when a < b, 0 when equal, positive when a > b. Anything after "+" or "-" is ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split(/[+-]/)[0].split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[+-]/)[0].split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export interface VersionVerdict { outdated: boolean; force: boolean; minVersion: string | null; message: string | null }

/** Compare the installed version with the owner's rule for this platform. */
export function versionVerdict(policy: VersionPolicy | undefined, platform: 'android' | 'web' | 'ios', installed: string): VersionVerdict {
  const rule = policy?.[platform];
  if (!rule || !installed) return { outdated: false, force: false, minVersion: null, message: null };
  const outdated = compareVersions(installed, rule.minVersion) < 0;
  return { outdated, force: outdated && rule.mode === 'force', minVersion: rule.minVersion, message: policy?.message ?? null };
}

export interface PopupAnnouncement { ts: number; popup?: boolean; show?: 'once' | 'always' | 'daily'; platforms?: string[] }

/**
 * Should the pop-up show? `seen` is what this device remembers: the last ts
 * it showed and the day ("YYYY-MM-DD") it last showed it. "always" shows on
 * every app open (once per session — the caller keeps that in memory).
 */
export function announcementDue(a: PopupAnnouncement | null | undefined, platform: string, seen: { ts?: number; day?: string } | null, today: string, shownThisSession: boolean): boolean {
  if (!a || !a.popup) return false;
  if (a.platforms && a.platforms.length && !a.platforms.includes(platform)) return false;
  const show = a.show ?? 'once';
  if (show === 'always') return !shownThisSession;
  if (!seen || seen.ts !== a.ts) return true;
  if (show === 'daily') return seen.day !== today;
  return false;
}
