/**
 * VinaX AI artifacts run on their own origin: the app may frame the sandbox
 * host, and nothing else about it changes (no scripts, no connections). The
 * sandbox itself loads scripts from three CDNs and fetches files from two
 * of them (three.js assets), never from the app.
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
  it('reaches only the two script CDNs for files (three.js models, textures, decoders), never the app, and only VinaX may frame it', () => {
    const connect = /connect-src ([^;]+)/.exec(sandbox)![1].split(/\s+/);
    expect(connect).toEqual(['https://cdn.jsdelivr.net', 'https://unpkg.com', 'blob:', 'data:']);
    expect(sandbox).not.toMatch(/connect-src[^;]*(vinaxmusic\.online|\*|https:\s)/);
    expect(sandbox).toMatch(/frame-ancestors https:\/\/www\.vinaxmusic\.online http:\/\/localhost:\*/);
    expect(sandbox).toMatch(/default-src 'none'/);
    // Scripts: the three CDNs and nothing else (no data:, no *).
    const scripts = /script-src ([^;]+)/.exec(sandbox)![1].split(/\s+/).filter((v) => !v.startsWith("'"));
    expect(scripts).toEqual(['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com']);
  });
  it('listens only to VinaX (and localhost for development): the page framing it, or the tab that opened it', () => {
    expect(runner).toContain("var ALLOWED = /^(https:\\/\\/www\\.vinaxmusic\\.online|https?:\\/\\/localhost(:\\d+)?)$/;");
    expect(runner).toContain('var host = window.parent !== window ? window.parent : window.opener;');
    expect(runner).toContain('e.source !== host || !ALLOWED.test(e.origin)');
    // Opened in a tab of its own, the link back to VinaX is cut before an artifact runs.
    expect(runner).toContain('window.opener = null');
  });
  it('loads its libraries only from pinned versions its CSP allows', () => {
    const urls = [...runner.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]).filter((u) => u !== 'https://cdnjs.cloudflare.com/ajax/libs/').concat([...runner.matchAll(/CDN \+ '([^']+)'/g)].map((m) => `https://cdnjs.cloudflare.com/ajax/libs/${m[1]}`));
    expect(urls.length).toBeGreaterThan(6);
    for (const u of urls) {
      expect(u, u).toMatch(/@?\d+\.\d+\.\d+\//);
      const host = new URL(u).origin;
      expect(['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com'], u).toContain(host);
      expect(sandbox, u).toContain(host);
    }
  });
});
