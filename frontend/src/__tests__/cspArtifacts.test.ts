/**
 * VinaX AI artifacts run on their own origin: the app may frame the sandbox
 * host, and nothing else about it changes (no scripts, no connections).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const headers = readFileSync(resolve(__dirname, '../../public/_headers'), 'utf8');
const csp = /Content-Security-Policy: (.+)/.exec(headers)![1];
const directive = (name: string) => (new RegExp(`(?:^|; )${name} ([^;]+)`).exec(csp)?.[1] ?? '').split(/\s+/);

describe('the app CSP and the artifact sandbox', () => {
  it('frames the sandbox host', () => {
    expect(directive('frame-src')).toContain('https://sandbox.vinaxmusic.online');
  });
  it('never runs or talks to it', () => {
    expect(directive('script-src')).not.toContain('https://sandbox.vinaxmusic.online');
    expect(csp).not.toMatch(/connect-src[^;]*sandbox\.vinaxmusic\.online/);
  });
});

describe('the sandbox site', () => {
  const sandbox = readFileSync(resolve(__dirname, '../../../sandbox/_headers'), 'utf8');
  const runner = readFileSync(resolve(__dirname, '../../../sandbox/index.html'), 'utf8');
  it('cannot reach the network, and only VinaX may frame it', () => {
    expect(sandbox).toMatch(/connect-src 'none'/);
    expect(sandbox).toMatch(/frame-ancestors https:\/\/www\.vinaxmusic\.online http:\/\/localhost:\*/);
    expect(sandbox).toMatch(/default-src 'none'/);
  });
  it('listens only to VinaX (and localhost for development)', () => {
    expect(runner).toContain("var ALLOWED = /^(https:\\/\\/www\\.vinaxmusic\\.online|https?:\\/\\/localhost(:\\d+)?)$/;");
    expect(runner).toContain('e.source !== window.parent');
  });
  it('loads its libraries only from pinned versions its CSP allows', () => {
    const urls = [...runner.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]).filter((u) => u !== 'https://cdnjs.cloudflare.com/ajax/libs/').concat([...runner.matchAll(/CDN \+ '([^']+)'/g)].map((m) => `https://cdnjs.cloudflare.com/ajax/libs/${m[1]}`));
    expect(urls.length).toBeGreaterThan(6);
    for (const u of urls) {
      expect(u, u).toMatch(/@?\d+\.\d+\.\d+\//);
      const allowed = u.startsWith('https://cdnjs.cloudflare.com/') || sandbox.includes(u.replace(/dist\/.*$/, '').replace(/\/$/, '/'));
      expect(allowed, u).toBe(true);
    }
  });
});
