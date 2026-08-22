/**
 * v4.13.3 — reinstall guidance for signature-blocked updates. Android
 * permanently refuses installing an APK over an app signed with a different
 * key ("package conflicts with an existing package") — the fate of every
 * device still on an old debug-signed build. There is no installer callback,
 * so the ONLY reliable signal is: attempt recorded → app relaunched → update
 * dialog back for the SAME build. These tests pin that detection logic.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { installLikelyBlocked, markUpdateAttempt } from '../services/update';
import { KEYS } from '../constants/storage-keys';

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('install-attempt tracking', () => {
  it('no attempt recorded → not blocked (first-ever dialog is the normal flow)', () => {
    expect(installLikelyBlocked(1500)).toBe(false);
  });

  it('fresh attempt (<10 min) → not blocked yet: the installer may still be open on top', () => {
    vi.setSystemTime(new Date(2026, 7, 11, 19, 0));
    markUpdateAttempt(1500);
    vi.setSystemTime(new Date(2026, 7, 11, 19, 5));
    expect(installLikelyBlocked(1500)).toBe(false);
  });

  it('same build resurfacing after 10+ min → blocked: switch to reinstall guidance', () => {
    vi.setSystemTime(new Date(2026, 7, 11, 19, 0));
    markUpdateAttempt(1500);
    vi.setSystemTime(new Date(2026, 7, 11, 19, 20));
    expect(installLikelyBlocked(1500)).toBe(true);
  });

  it('a NEWER build is a fresh start — old attempt does not poison it', () => {
    vi.setSystemTime(new Date(2026, 7, 11, 19, 0));
    markUpdateAttempt(1500);
    vi.setSystemTime(new Date(2026, 7, 12, 19, 0));
    expect(installLikelyBlocked(1501)).toBe(false);
  });

  it('corrupt storage never throws — treated as no-attempt', () => {
    localStorage.setItem(KEYS.updateAttempt, '{not json');
    expect(installLikelyBlocked(1500)).toBe(false);
  });
});
