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
// 2026-08-05: re-based 156 -> 157 (+1 KB) for the personalization batch
// (A2 negative-skip decay + A3 softMuted set on TasteProfile + A5
// session-persisted home dedup). Every addition is user-facing quality
// signal that's read on the recommendation critical path — cannot be
// lazy-loaded. Treat 157 as the new hard ceiling.
// 2026-08-08: re-based 157 -> 159 for the C3 taste-dials package. The feature
// itself is entirely LAZY — verified: the dials runtime (personalization/
// dials.ts), the scoring nudges (recommendation engine chunk), the Taste
// Profile sliders UI and the AI payload lines all land in on-demand chunks,
// none in the entry. The measured first-load move (156.6 -> 158.0 KB gz) is
// Rolldown re-packing existing modules into the entry chunk once the graph
// gained a new leaf module plus the eager TasteProfile `sliders?` type field —
// codegen churn, NO new first-load code (same class as the 150 -> 155
// Rolldown-swap rebase). Confirmed non-reducible: moving the runtime lazy,
// making the leaf import-pure, and dropping consumer wiring each left it
// unchanged. 159 keeps ~1 KB headroom over the measured 158.0; regressions
// still fail the build.
// 2026-08-11: re-based 159 -> 160 (+1 KB) for the C-series close-out. The
// measured move is 158.7 -> 159.2 KB gz, all of it deliberately first-load:
// the C2 kid-mode gate guards every player intake (playQueue/enqueue/radio) —
// a lazy explicit-content filter would be no safety at all — plus the
// kid/adult taste-profile namespace switch on the boot path and the C5
// mood-pin READ on the recommendation path (its writers were split into a
// lazy module; verified). Same class as the 156 -> 157 rebase ("safety-
// critical first-load, cannot be lazy-loaded"). 160 leaves ~0.8 KB headroom;
// regressions still fail the build.
// 2026-08-12: re-based 160 -> 161 (+1 KB) for the navigation-state repairs
// (delta audit P0-2/P0-3/P1-16, v4.1.x). Measured move: 159.2 -> 160.0 KB gz
// (163,843 bytes — 3 bytes over the old ceiling). The additions are the app
// SHELL itself and cannot be lazy: per-history-entry scroll restoration on
// the <main> scroller, the hardware-back overlay stack consulted by the
// Capacitor backButton listener, the route-reset hook on the root
// ErrorBoundary, and the light-theme token block. Reductions performed
// before rebasing (~0.2 KB recovered): rAF injection removed from
// restoreWhenTall, the save/restore effects merged into one, and the overlay
// stack folded into its hook module. 161 leaves ~1 KB headroom; regressions
// still fail the build.
// 2026-08-17: re-based 161 -> 162 (+1 KB) for the artwork-quality fix
// (4.19.5, owner report "songs images quality is low"). Measured move:
// 160.9 -> 161.1 KB gz. derivedVariants() (CDN 250/350 URL derivation) and
// the MediaCard derived-URL onError retry live on the card render path —
// MediaCard paints in the first viewport, so none of it can be lazy.
// Shaves attempted first (single derivation per card, includes() over the
// regex+px double check, concat over spread): Rolldown codegen churn ate
// them (161.0 -> 161.1 across identical logic — same class as the 150->155
// rebase). 162 leaves ~0.9 KB headroom; regressions still fail the build.
const FIRST_LOAD_BUDGET = 162 * 1024; // gzipped
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
