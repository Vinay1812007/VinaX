#!/usr/bin/env node
/**
 * Run the offline evaluation of next-song selection and write its reports.
 *
 *   node scripts/eval-recs.mjs                     current + baseline, JSON + Markdown
 *   node scripts/eval-recs.mjs --no-baseline       the current pipeline only
 *   node scripts/eval-recs.mjs --quick             fewer salts and latency runs
 *   node scripts/eval-recs.mjs --baseline 7c4e2f5  compare against another commit
 *   node scripts/eval-recs.mjs --out ../tmp/eval   write the reports elsewhere
 *
 * The baseline is the WHOLE frontend source at that commit, extracted with
 * `git archive` into eval/.cache/ (git-ignored) and run against the same
 * fixtures, by the same harness, with the same measuring stick. Nothing of
 * the baseline is committed and nothing of the working tree is touched: the
 * only difference between the two runs is where `@` points.
 *
 * What this measures: rule compliance, diversity mechanics, fallback
 * behaviour and latency. Not whether anyone enjoys the songs.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..');
const REPO = resolve(FRONTEND, '..');

function parseArgs(argv) {
  const out = { baseline: '7c4e2f5', withBaseline: true, quick: false, out: null, salts: null, latencyRuns: null, cap: null, reportOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--report-only') out.reportOnly = true;
    else if (a === '--no-baseline') out.withBaseline = false;
    else if (a === '--quick') out.quick = true;
    else if (a === '--baseline') out.baseline = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--salts') out.salts = argv[++i];
    else if (a === '--latency-runs') out.latencyRuns = argv[++i];
    else if (a === '--cap-ms') out.cap = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
      process.exit(0);
    } else {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const OUT_DIR = args.out ? resolve(process.cwd(), args.out) : resolve(FRONTEND, 'eval/reports');
const SALTS = args.salts ?? (args.quick ? '3' : '12');
const LATENCY_RUNS = args.latencyRuns ?? (args.quick ? '3' : '8');
const CAP_MS = args.cap ?? '12000';

const git = (...a) => spawnSync('git', ['-C', REPO, ...a], { encoding: 'utf8' });

function head() {
  const r = git('rev-parse', '--short', 'HEAD');
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

/** The baseline source tree, extracted once per commit. */
function extractBaseline(ref) {
  const resolved = git('rev-parse', '--short', ref);
  if (resolved.status !== 0) {
    console.error(`Cannot resolve ${ref}: ${resolved.stderr.trim()}`);
    process.exit(1);
  }
  const short = resolved.stdout.trim();
  const dir = resolve(FRONTEND, 'eval/.cache', `baseline-${short}`);
  if (existsSync(resolve(dir, 'src'))) return { dir, short };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const archive = spawnSync('git', ['-C', REPO, 'archive', short, 'frontend/src'], { maxBuffer: 512 * 1024 * 1024 });
  if (archive.status !== 0) {
    console.error(`git archive ${short} failed: ${String(archive.stderr)}`);
    process.exit(1);
  }
  const untar = spawnSync('tar', ['-x', '--strip-components=1', '-C', dir], { input: archive.stdout });
  if (untar.status !== 0) {
    console.error(`tar failed: ${String(untar.stderr)}`);
    process.exit(1);
  }
  // The baseline's own unit tests come along in the archive; `npx vitest run`
  // would then collect them from here. They are of no use to the evaluation.
  dropTests(resolve(dir, 'src'));
  return { dir, short };
}

function dropTests(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) dropTests(full);
    else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) rmSync(full);
  }
}

function runEval({ pipeline, ref, src, assert }) {
  const outFile = resolve(OUT_DIR, `recs-eval-${pipeline}.json`);
  mkdirSync(OUT_DIR, { recursive: true });
  const env = {
    ...process.env,
    EVAL_PIPELINE: pipeline,
    EVAL_REF: ref,
    EVAL_OUT: outFile,
    EVAL_SALTS: SALTS,
    EVAL_LATENCY_RUNS: LATENCY_RUNS,
    EVAL_LATENCY_CAP_MS: CAP_MS,
    EVAL_ASSERT: assert ? '1' : '0',
  };
  if (src) env.EVAL_SRC = src;
  console.log(`\n▸ ${pipeline} (${ref}${src ? `, frozen source in ${src.replace(FRONTEND, 'frontend')}` : ''})`);
  const run = spawnSync('npx', ['vitest', 'run', '--config', 'eval/vitest.config.ts'], { cwd: FRONTEND, env, encoding: 'utf8' });
  process.stdout.write((run.stdout ?? '').split('\n').filter((l) => /Test Files|Tests|Duration|FAIL|AssertionError/.test(l)).join('\n'));
  if (!existsSync(outFile)) {
    console.error(`\nNo report written for ${pipeline}.\n${run.stdout ?? ''}\n${run.stderr ?? ''}`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(outFile, 'utf8'));
  report.testExit = run.status;
  return report;
}

/* ---- reporting ---- */

const pct = (n) => `${(n * 100).toFixed(1)} %`;
const ms = (n) => `${n.toFixed(n < 100 ? 1 : 0)} ms`;
const arrow = (a, b, betterIsLower = true) => {
  if (a === b) return '=';
  const better = betterIsLower ? b < a : b > a;
  return better ? 'better' : 'worse';
};

function metricRows(base, now) {
  const rows = [
    ['Continuations planned (samples)', base?.batches ?? 0, now.batches, null],
    ['Songs queued', base?.songs ?? 0, now.songs, null],
    ['Empty continuations', base?.emptyBatches ?? 0, now.emptyBatches, true],
    ['Hard-rule violations (must be 0)', base?.hardViolations ?? 0, now.hardViolations, true],
    ['…in the order queued first', base?.queueReadyHardViolations ?? 0, now.queueReadyHardViolations, true],
    ['Off-language songs under a relaxed lock', base?.offLanguageExcused ?? 0, now.offLanguageExcused, true],
    ['Same lead artist back to back', base?.repetition.sameLeadBackToBack ?? 0, now.repetition.sameLeadBackToBack, true],
    ['…of those, at a batch boundary', base?.repetition.sameLeadAtBatchBoundary ?? 0, now.repetition.sameLeadAtBatchBoundary, true],
    ['Same lead artist within three songs', base?.repetition.sameLeadWithinThree ?? 0, now.repetition.sameLeadWithinThree, true],
    ['Same song identity back to back', base?.repetition.sameIdentityBackToBack ?? 0, now.repetition.sameIdentityBackToBack, true],
    ['A song identity heard twice in a sitting', base?.repetition.repeatedIdentity ?? 0, now.repetition.repeatedIdentity, true],
    ['Distinct lead artists per continuation', base?.coverage.distinctArtistsPerBatch ?? 0, now.coverage.distinctArtistsPerBatch, false],
    ['Distinct lead artists per sitting (share)', base?.coverage.distinctArtistShareInSession ?? 0, now.coverage.distinctArtistShareInSession, false],
    ['Discovery share', base?.discovery.share ?? 0, now.discovery.share, null],
    ['…the mode’s allocation', base?.discovery.allocation ?? 0, now.discovery.allocation, null],
    ['Continuations over the allocation (familiar songs were free)', base?.discovery.overAllocatedBatches ?? 0, now.discovery.overAllocatedBatches, true],
    ['Familiar-first compliance (slot 1)', base?.familiarFirst.compliance ?? 0, now.familiarFirst.compliance, false],
    ['Queue-ready latency p50', base?.latency.p50 ?? 0, now.latency.p50, true],
    ['Queue-ready latency p95', base?.latency.p95 ?? 0, now.latency.p95, true],
  ];
  return rows.map(([label, a, b, lower]) => {
    const fmt = /share|compliance/i.test(label) ? pct : /latency/.test(label) ? ms : (n) => String(Math.round(n * 1000) / 1000);
    return `| ${label} | ${fmt(a)} | ${fmt(b)} | ${lower === null ? '—' : arrow(a, b, lower)} |`;
  });
}

function markdown(now, base) {
  const lines = [];
  lines.push('# Offline evaluation of next-song selection', '');
  lines.push(`Generated ${now.generatedAt} · fixtures ${now.fixturesVersion} · harness ${now.harnessVersion} · ${now.salts} salts per fixture.`, '');
  lines.push(`| | Baseline | Current |`, `| --- | --- | --- |`);
  lines.push(`| Commit | ${base?.ref ?? '—'} | ${now.ref || 'working tree'} |`);
  lines.push(`| Entry point | ${base?.entry ?? '—'} | ${now.entry} |`);
  lines.push(`| Algorithm version | ${base?.alg ?? '—'} | ${now.alg} |`);
  lines.push(`| Reproducible (same salts, same songs) | ${base ? (base.deterministic ? 'yes' : 'NO') : '—'} | ${now.deterministic ? 'yes' : 'NO'} |`, '');
  lines.push('These numbers measure rule compliance, diversity mechanics and latency against synthetic fixtures.', 'They do not measure whether a listener enjoys the songs.', '');
  lines.push('## Baseline versus current', '');
  lines.push('| Metric | Baseline | Current | |', '| --- | ---: | ---: | --- |');
  lines.push(...metricRows(base?.quality.overall, now.quality.overall));
  lines.push('');
  lines.push('## Per fixture (current pipeline)', '');
  lines.push('| Fixture | Continuations | Songs | Empty | Hard violations | Discovery share | Slot-1 misses |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [id, f] of Object.entries(now.quality.perFixture)) {
    lines.push(`| ${f.title} (\`${id}\`) | ${f.batches} | ${f.songs} | ${f.emptyBatches} | ${f.hardViolations} | ${pct(f.discovery.share)} | ${f.familiarFirst.slot1Misses}/${f.familiarFirst.opportunities} |`);
  }
  lines.push('');
  lines.push('## Latency', '');
  lines.push('| Condition | Runs | Pool | Cap | Queue-ready p50 | p95 | Final order p50 | p95 | Songs | Cut off |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const c of now.latency) {
    if (c.skipped) continue;
    const b = base?.latency?.find((x) => x.id === c.id && !x.skipped);
    const row = (label, x) => `| ${label} | ${x.runs} | ${x.poolSize ?? '—'} | ${ms(x.capMs)} | ${ms(x.queueReadyP50)} | ${ms(x.queueReadyP95)} | ${ms(x.finalP50)} | ${ms(x.finalP95)} | ${x.songsMean} | ${x.censored} |`;
    lines.push(row(`${c.id} — current`, c));
    if (b) lines.push(row(`${c.id} — baseline`, b));
    else lines.push(`| ${c.id} — baseline | — | — | — | — | — | — | — | — | — |`);
  }
  lines.push('', 'A run "cut off" hit the harness cap for that condition: its latency is a floor, not a measurement.', '');
  for (const c of now.latency) lines.push(`- \`${c.id}\` — ${c.notes}`);
  lines.push('');
  lines.push('## Fixtures', '');
  lines.push('| Fixture | What it is for | Pool | Mode | AI |', '| --- | --- | ---: | --- | --- |');
  for (const f of now.fixtures) lines.push(`| ${f.title} (\`${f.id}\`) | ${f.notes} | ${f.related + f.search} | ${f.mode} | ${f.ai} |`);
  lines.push('');
  return lines.join('\n');
}

/* ---- go ---- */

const readReport = (pipeline) => {
  const file = resolve(OUT_DIR, `recs-eval-${pipeline}.json`);
  if (!existsSync(file)) {
    console.error(`--report-only needs ${file}; run the evaluation first.`);
    process.exit(1);
  }
  return { ...JSON.parse(readFileSync(file, 'utf8')), testExit: 0 };
};

const currentRef = head();
let current;
let baseline = null;
if (args.reportOnly) {
  current = readReport('current');
  if (args.withBaseline) baseline = readReport('baseline');
} else {
  current = runEval({ pipeline: 'current', ref: currentRef, src: null, assert: true });
  if (args.withBaseline) {
    const { dir, short } = extractBaseline(args.baseline);
    baseline = runEval({ pipeline: 'baseline', ref: short, src: resolve(dir, 'src'), assert: false });
  }
}

const jsonPath = resolve(OUT_DIR, 'recs-eval.json');
const mdPath = resolve(OUT_DIR, 'recs-eval.md');
writeFileSync(jsonPath, `${JSON.stringify({ current, baseline }, null, 2)}\n`);
writeFileSync(mdPath, markdown(current, baseline));

const o = current.quality.overall;
console.log('\n── summary ──────────────────────────────────────────');
console.log(`fixtures ${current.fixturesVersion} · harness ${current.harnessVersion} · ${current.salts} salts · entry ${current.entry} · alg ${current.alg}`);
console.log(`continuations ${o.batches} · songs ${o.songs} · empty ${o.emptyBatches} · reproducible ${current.deterministic ? 'yes' : 'NO'}`);
console.log(`hard-rule violations ${o.hardViolations} (queue-ready ${o.queueReadyHardViolations}) · off-language under a relaxed lock ${o.offLanguageExcused}`);
console.log(`same lead back to back ${o.repetition.sameLeadBackToBack} (batch boundary ${o.repetition.sameLeadAtBatchBoundary}) · identity repeats ${o.repetition.repeatedIdentity}`);
console.log(`distinct artists per continuation ${o.coverage.distinctArtistsPerBatch} · discovery ${pct(o.discovery.share)} against an allocation of ${pct(o.discovery.allocation)}`);
console.log(`familiar-first compliance ${pct(o.familiarFirst.compliance)} · pickers ${JSON.stringify(o.pickers)} · fallbacks ${JSON.stringify(o.fallbacks)}`);
console.log(`queue-ready latency p50 ${ms(o.latency.p50)} · p95 ${ms(o.latency.p95)} (instant sources, ${o.latency.samples} samples)`);
if (baseline) {
  const b = baseline.quality.overall;
  console.log(`baseline ${baseline.ref}: hard violations ${b.hardViolations} · identity repeats ${b.repetition.repeatedIdentity} · same lead back to back ${b.repetition.sameLeadBackToBack}`);
}
console.log(`\nreports: ${jsonPath.replace(FRONTEND, 'frontend')} · ${mdPath.replace(FRONTEND, 'frontend')}`);
console.log('These numbers are rule compliance, diversity mechanics and latency — not enjoyment.');
process.exit(current.testExit === 0 ? 0 : 1);
