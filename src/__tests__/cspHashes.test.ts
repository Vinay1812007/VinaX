/**
 * The v4.13.0 white-screen: `public/_headers` locks the CSP to sha256 hashes
 * of every inline script in index.html. When those scripts change and the
 * hash list isn't updated in the same commit, every browser blocks the
 * pre-paint theme + boot self-healing scripts and the app never leaves the
 * splash. The build now runs scripts/csp-hashes.mjs to auto-sync — this test
 * is the tripwire that fails loudly if that automation ever regresses.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const m of html.matchAll(/<script(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/script>/g)) {
    const attrs = (m.groups?.attrs ?? '').trim();
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(attrs)) continue;
    hashes.push(createHash('sha256').update(m.groups?.body ?? '').digest('base64'));
  }
  return hashes;
}

describe('CSP script-src hash contract', () => {
  const htmlPath = resolve(__dirname, '../../index.html');
  const headersPath = resolve(__dirname, '../../public/_headers');
  const html = readFileSync(htmlPath, 'utf8');
  const headers = readFileSync(headersPath, 'utf8');

  it('every executable inline script in index.html has its hash listed in the CSP', () => {
    const required = inlineScriptHashes(html);
    // Source index.html carries at least one inline script (the pre-paint
    // theme block); prerender adds the JSON-LD and boot self-healing at
    // build time. Both must always survive the round-trip.
    expect(required.length).toBeGreaterThanOrEqual(1);
    for (const h of required) {
      expect(
        headers,
        `CSP is missing sha256-${h} — run \`npm run build\` (it now runs scripts/csp-hashes.mjs) then commit public/_headers.`,
      ).toContain(`sha256-${h}`);
    }
  });

  it('script-src carries no obviously unsafe keywords (regression guard)', () => {
    const cspLine = headers.match(/^ {2}Content-Security-Policy: .+$/m)?.[0] ?? '';
    // Isolate just the script-src directive. style-src legitimately uses
    // 'unsafe-inline' for Tailwind's runtime classes; that is not our concern here.
    const scriptSrc = /script-src ([^;]+)/.exec(cspLine)?.[1] ?? '';
    expect(scriptSrc, 'script-src').not.toContain("'unsafe-eval'");
    expect(scriptSrc, 'script-src').not.toContain("'unsafe-inline'");
    // 'unsafe-hashes' would defeat the whole hash contract.
    expect(scriptSrc, 'script-src').not.toContain("'unsafe-hashes'");
  });
});
