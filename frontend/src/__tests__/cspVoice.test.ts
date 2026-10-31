/**
 * VinaX AI voice and the app's headers: the page may open the microphone
 * and Gemini Live's WebSocket, and nothing more (no Gemini REST from the
 * browser: those calls carry the key and stay in the Worker; no blob:
 * scripts: the mic worklet is a same-origin file).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const headers = readFileSync(resolve(__dirname, '../../public/_headers'), 'utf8');
const csp = /Content-Security-Policy: (.+)/.exec(headers)![1];
const directive = (name: string) => (new RegExp(`(?:^|; )${name} ([^;]+)`).exec(csp)?.[1] ?? '').split(/\s+/);

describe('voice in the app CSP', () => {
  it('connects to Gemini Live over a secure WebSocket only', () => {
    expect(directive('connect-src')).toContain('wss://generativelanguage.googleapis.com');
    expect(directive('connect-src')).not.toContain('https://generativelanguage.googleapis.com');
    expect(directive('connect-src').some((h) => h.includes('groq.com'))).toBe(false);
  });
  it('runs the mic worklet from the app itself, never from blob:', () => {
    expect(directive('script-src')).toContain("'self'");
    expect(directive('script-src')).not.toContain('blob:');
  });
  it('lets the app (and only the app) use the microphone', () => {
    expect(headers).toMatch(/Permissions-Policy: [^\n]*microphone=\(self\)/);
  });
});
