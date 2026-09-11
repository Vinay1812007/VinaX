/**
 * v5.32.0 — session insights are OPT-IN ONLY and text-masked. These tests pin
 * the contract the Privacy page promises: no consent → nothing loads; consent
 * → exactly one tag, every on-screen text masked, ad storage denied.
 *
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const consent = vi.hoisted(() => ({ optedIn: false }));
vi.mock('../services/analytics/telemetry', () => ({ consented: () => consent.optedIn }));

import { initSessionInsights, resetSessionInsightsForTest } from '../services/analytics/sessionInsights';

const tags = () => document.querySelectorAll<HTMLScriptElement>('script[src^="https://www.clarity.ms/tag/"]');

beforeEach(() => {
  consent.optedIn = false;
  resetSessionInsightsForTest();
  document.head.innerHTML = '';
  document.body.removeAttribute('data-clarity-mask');
  delete window.clarity;
});

describe('session insights consent gate', () => {
  it('no opt-in → no tag, no queue, no masking attribute', () => {
    initSessionInsights(true);
    expect(tags()).toHaveLength(0);
    expect(window.clarity).toBeUndefined();
    expect(document.body.hasAttribute('data-clarity-mask')).toBe(false);
  });

  it('opted in but a dev build → nothing loads (keeps local sessions out of the data)', () => {
    consent.optedIn = true;
    initSessionInsights(false);
    expect(tags()).toHaveLength(0);
  });

  it('opted in on production → one async tag for this project, all text masked', () => {
    consent.optedIn = true;
    initSessionInsights(true);
    const loaded = tags();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].src).toBe('https://www.clarity.ms/tag/yghemvilpu');
    expect(loaded[0].async).toBe(true);
    expect(document.body.getAttribute('data-clarity-mask')).toBe('True');
  });

  it('queues a consent signal that grants analytics and denies ad storage', () => {
    consent.optedIn = true;
    initSessionInsights(true);
    expect(window.clarity?.q).toContainEqual(['consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }]);
  });

  it('is idempotent — onboarding + idle init never inject a second tag', () => {
    consent.optedIn = true;
    initSessionInsights(true);
    initSessionInsights(true);
    expect(tags()).toHaveLength(1);
  });
});

// A comment in _headers mentioning the hosts is not an allowance — only the
// directives are. Without these the browser silently blocks the tag.
describe('session insights CSP allowance', () => {
  const headers = readFileSync(resolve(__dirname, '../../public/_headers'), 'utf8');
  const csp = headers.match(/^ {2}Content-Security-Policy: .+$/m)?.[0] ?? '';
  const directive = (name: string) => new RegExp(`${name} ([^;]+)`).exec(csp)?.[1] ?? '';

  it('script-src allows the tag hosts', () => {
    expect(directive('script-src')).toContain('https://*.clarity.ms');
  });

  it('connect-src allows the upload hosts', () => {
    expect(directive('connect-src')).toContain('https://*.clarity.ms');
    expect(directive('connect-src')).toContain('https://c.bing.com');
  });
});
