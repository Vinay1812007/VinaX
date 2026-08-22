// CI gate: fail the build when first-load JS outgrows the budget.
// First load = every /assets/*.js referenced by dist/index.html (entry + modulepreload).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist';
// 2026-07-13: re-based 150 -> 155 for the Vite 8 / Rolldown swap. The new
// bundler ships the same first-paint modules as ~9 separate preloaded chunks
// (wrapper overhead + codegen diff, +5 KB gz measured, no new code). Treat
// 155 as the new hard ceiling — regressions still fail the build.
// 2026-07-31: re-based 155 -> 156 (+1 KB) for the security-fixes audit
// (audio engine visibility+preload guards H-FE-11/H-FE-13, media-session
// re-entrancy guard M-FE-2, announcement link tightening H-FE-12,
// personalization pagehide flush M-FE-8). All measurable additions are on
// safety-critical first-load code paths; treat 156 as the new hard ceiling.
const FIRST_LOAD_BUDGET = 156 * 1024; // gzipped
const CHUNK_BUDGET = 80 * 1024; // gzipped — chunks that ship in the first load
const LAZY_CHUNK_BUDGET = 160 * 1024; // gzipped — on-demand chunks (routes, features)
// Deliberately lazy diagram/math engines (loaded only when VinaX AI renders them).
const LAZY_EXEMPT = /mermaid|cytoscape|katex|cynefin|dagre|elk|flowchart|mindmap|treemap/i;

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const referenced = [...html.matchAll(/\/assets\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0].slice(1));
const unique = [...new Set(referenced)];

const gz = (rel) => gzipSync(readFileSync(join(DIST, rel))).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

let firstLoad = 0;
for (const rel of unique) {
  const size = gz(rel);
  firstLoad += size;
  console.log(`first-load  ${kb(size).padStart(9)}  ${rel}`);
}
console.log(`first-load TOTAL ${kb(firstLoad)} (budget ${kb(FIRST_LOAD_BUDGET)})`);

let fail = false;
// `>=` so a chunk landing exactly on the ceiling fails — one more KB of
// regression would land at the budget itself, which the comment above calls
// the "hard ceiling" (audit finding L12).
if (firstLoad >= FIRST_LOAD_BUDGET) {
  console.error(`FAIL: first-load JS ${kb(firstLoad)} meets or exceeds budget ${kb(FIRST_LOAD_BUDGET)}`);
  fail = true;
}

for (const f of readdirSync(join(DIST, 'assets'))) {
  if (!f.endsWith('.js')) continue;
  const rel = join('assets', f);
  const size = gz(rel);
  const inFirstLoad = unique.includes(rel.replace(/\\/g, '/')) || unique.includes(rel);
  // Audit finding M-OPS-3: LAZY_EXEMPT must ONLY skip on-demand chunks. If a
  // matched module ever ends up in the first-load set (e.g. an accidental
  // static import), the budget must still catch it.
  if (!inFirstLoad && LAZY_EXEMPT.test(f)) continue;
  const cap = inFirstLoad ? CHUNK_BUDGET : LAZY_CHUNK_BUDGET;
  if (size >= cap) {
    console.error(`FAIL: chunk assets/${f} is ${kb(size)} gz (budget ${kb(cap)}${inFirstLoad ? ', first-load' : ', lazy'})`);
    fail = true;
  }
}

if (fail) process.exit(1);
console.log('bundle budget: OK');
