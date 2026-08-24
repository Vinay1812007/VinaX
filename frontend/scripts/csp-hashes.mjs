#!/usr/bin/env node
/**
 * CSP hash reconciler — the automation that prevents the v4.13.0 white-screen
 * from ever happening again.
 *
 * The problem: `public/_headers` locks the Content-Security-Policy to specific
 * sha256 hashes of every inline <script> in index.html. Any edit to those
 * scripts changes their hash — and if _headers isn't updated in the same
 * commit, the browser blocks the pre-paint theme + boot self-healing scripts
 * and users see a stuck splash.
 *
 * This script runs after `vite build`, computes the hash of every inline
 * executable script in dist/index.html, and REWRITES the `script-src`
 * hash list in `dist/_headers` (and copies it back to `public/_headers` so
 * the source of truth stays consistent). External `<script src="…">` and
 * non-executable types (`application/ld+json`) are skipped.
 *
 * If the current _headers list is missing any current hash, the script logs
 * the diff — but the rewrite always emits the fresh set, so ship builds
 * cannot lag behind their own HTML.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const distHtml = resolve('dist/index.html');
const distHeaders = resolve('dist/_headers');
const srcHeaders = resolve('public/_headers');

const html = readFileSync(distHtml, 'utf8');

// Match every <script>...</script>; capture attributes so we can skip
// external + JSON-LD (browsers don't run those against script-src).
const RE = /<script(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/script>/g;
const hashes = [];
for (const m of html.matchAll(RE)) {
  const attrs = (m.groups?.attrs ?? '').trim();
  const body = m.groups?.body ?? '';
  if (/\bsrc\s*=/.test(attrs)) continue; // external script — allowed via 'self'
  if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(attrs)) continue;
  const h = createHash('sha256').update(body).digest('base64');
  hashes.push(`'sha256-${h}'`);
}

if (hashes.length === 0) {
  console.error('csp-hashes: no inline scripts found in dist/index.html — refusing to strip the CSP');
  process.exit(1);
}

let headers = readFileSync(distHeaders, 'utf8');
const cspLine = headers.match(/^ {2}Content-Security-Policy: .+$/m)?.[0];
if (!cspLine) {
  console.error('csp-hashes: no Content-Security-Policy line found in dist/_headers');
  process.exit(1);
}

// Replace ONLY the sha256-… hashes inside script-src, keep everything else
// (keywords, external hosts, other directives) untouched.
const rewritten = cspLine.replace(
  /(script-src [^;]*?)('sha256-[^']+'\s*)+/,
  (_all, prefix) => `${prefix}${hashes.join(' ')} `,
);

const oldHashes = [...cspLine.matchAll(/'sha256-[^']+'/g)].map((m) => m[0]);
const currentSet = new Set(hashes);
const oldSet = new Set(oldHashes);
const added = hashes.filter((h) => !oldSet.has(h));
const removed = oldHashes.filter((h) => !currentSet.has(h));

if (rewritten === cspLine) {
  console.log(`csp-hashes: OK — ${hashes.length} inline script hashes already match dist/index.html`);
} else {
  if (added.length) console.log('csp-hashes: added', added.join(' '));
  if (removed.length) console.log('csp-hashes: removed', removed.join(' '));
  const nextHeaders = headers.replace(cspLine, rewritten);
  writeFileSync(distHeaders, nextHeaders);
  // Mirror back to the source _headers so commits capture the new hashes.
  writeFileSync(srcHeaders, readFileSync(srcHeaders, 'utf8').replace(cspLine, rewritten));
}
