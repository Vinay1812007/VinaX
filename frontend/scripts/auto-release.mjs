/**
 * Auto release — every merge to main becomes a numbered release.
 *
 * The release contract (README "How releases work") moves four things in
 * lock-step: `version` in package.json and package-lock.json, LATEST_VERSION
 * and DISPLAY_VERSION in src/constants/version.ts, and a new What's New card
 * at the top of CHANGELOG_V2 in src/constants/changelog.ts.
 * src/constants/release.test.ts fails when they disagree. Doing this by hand
 * on every merge meant it rarely happened: five builds of "14.0.1" shipped on
 * one day and no listener saw an update. This script does it in CI
 * (.github/workflows/auto-release.yml). The card is written from the merged
 * pull request's title and description (RELEASE_PR_MESSAGE, which the
 * workflow looks up), whatever merge method was used; without a pull
 * request, from the merge commit's own title and body.
 *
 *   node scripts/auto-release.mjs            bump from HEAD's commit message
 *   node scripts/auto-release.mjs --dry-run  print what would change
 *
 * Bump level: patch, unless the SUBJECT line says `#minor` or `#major`, or
 * a line of the body is exactly "release: minor" / "release: major". The
 * merge is left alone when it already changed the version (a manual
 * release), or when the subject says `[skip release]` or a body line is
 * exactly "release: skip", in the merge commit or in the pull request (its
 * title, or a line of its description). A description may *talk about*
 * these markers (the first automatic release was skipped by its own
 * documentation), so prose never counts.
 *
 * Exports are pure so they can be unit-tested (src/__tests__/autoRelease.test.ts).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Next semver for a bump level. */
export function bumpVersion(version, level = 'patch') {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`not a semver: ${version}`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * What a commit message asks of the release: the subject's `#major`,
 * `#minor` or `[skip release]`, or a body line that is exactly
 * "release: major|minor|skip". Markers inside backticks and anywhere else in
 * the body are prose and are ignored.
 */
export function directiveOf(message) {
  const lines = message.replace(/\r/g, '').split('\n');
  const subject = (lines[0] ?? '').replace(/`[^`]*`/g, '').toLowerCase();
  const own = (word) => lines.slice(1).some((l) => new RegExp(`^\\s*release:\\s*${word}\\s*$`, 'i').test(l));
  if (/\[skip release\]/.test(subject) || own('skip')) return 'skip';
  if (/(^|\s)#major\b/.test(subject) || own('major')) return 'major';
  if (/(^|\s)#minor\b/.test(subject) || own('minor')) return 'minor';
  return 'patch';
}

const DIRECTIVE_RANK = { patch: 0, minor: 1, major: 2, skip: 3 };

/**
 * What the merge asks of the release, read from the merge commit and from
 * the pull request it came from (its title and description): the stronger
 * request wins, and either one asking to skip skips.
 */
export function directiveOfMerge(commitMessage, prMessage = '') {
  const a = directiveOf(commitMessage);
  const b = prMessage && prMessage.trim() ? directiveOf(prMessage) : 'patch';
  return DIRECTIVE_RANK[b] > DIRECTIVE_RANK[a] ? b : a;
}

/**
 * The message the What's New card is written from: the pull request's
 * title and description when the merge came from one, else the merge
 * commit's own message. A squash merged from GitHub's button does not
 * carry the description: its body lists the branch's commits ("* subject"),
 * and those internal lines used to become the card (1.3.8, 1.3.10, 1.3.11).
 */
export function cardMessage(commitMessage, prMessage = '') {
  return prMessage && prMessage.trim() ? prMessage : commitMessage;
}

/** The bump level a commit message asks for (never 'skip'). */
export function levelOf(message) {
  const d = directiveOf(message);
  return d === 'skip' ? 'patch' : d;
}

/** Strip markdown and merge noise from one line of a commit message. */
function cleanLine(line) {
  return line
    .replace(/\s*\(#\d+\)\s*$/, '') // "(#149)" squash suffix
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '') // bullet
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The change type a line reads as. */
function typeOf(text, fallback = 'improved') {
  const t = text.toLowerCase();
  if (/\b(fix|fixed|fixes|bug|broken|crash|regression|wrong|no longer|stopped)\b/.test(t)) return 'fixed';
  if (/\b(new|add|added|adds|introduce|introduces|now you can|can now)\b/.test(t)) return 'new';
  return fallback;
}

/**
 * A What's New card from a merge commit message: the subject is the title,
 * the body's bullet lines (up to four) are the changes; with no bullets, the
 * first prose line; with nothing usable, a generic line.
 */
export function entryFromMessage(message) {
  const lines = message.replace(/\r/g, '').split('\n');
  // "fix(player): …" / "QA: …" prefixes are for the log, not the card.
  const title = cleanLine(lines[0] ?? '').replace(/^(?:release|chore|fix|feat|docs|ci|qa|build|refactor|test|perf)(?:\([^)]*\))?:\s*/i, '') || 'Improvements and fixes';
  // A fix in the subject makes "fixed" the default for its lines.
  const fallback = typeOf(lines[0] ?? '') === 'fixed' ? 'fixed' : 'improved';
  const body = lines.slice(1);
  const trailer = /^(co-authored-by|claude-session|signed-off-by|🤖|https?:\/\/)/i;
  const bullets = body.filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(l)).map(cleanLine).filter((l) => l.length > 8 && !trailer.test(l));
  let changes = bullets.slice(0, 4).map((text) => ({ type: typeOf(text, fallback), text: clip(text) }));
  if (!changes.length) {
    const prose = body.map(cleanLine).find((l) => l.length > 24 && !trailer.test(l) && !/^#/.test(l));
    changes = [{ type: typeOf(prose ?? title, fallback), text: clip(prose ?? title) }];
  }
  return { title: clip(title.charAt(0).toUpperCase() + title.slice(1), 90, false), changes };
}

/** Trim to `max` characters on a word boundary; a sentence gets its full stop. */
function clip(text, max = 240, sentence = true) {
  const t = text.trim();
  if (t.length <= max) return !sentence || /[.!?…]$/.test(t) ? t : `${t}.`;
  return `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;

/** changelog.ts with a new card on top of CHANGELOG_V2. */
export function insertChangelogEntry(source, version, entry) {
  const marker = 'export const CHANGELOG_V2: Record<string, VersionInfo> = {\n';
  const at = source.indexOf(marker);
  if (at < 0) throw new Error('CHANGELOG_V2 not found in changelog.ts');
  // Only the V2 line counts: the classic history (1.x–15.x) reuses version numbers V2 will reach.
  const end = source.indexOf('\n};', at);
  if (source.slice(at, end < 0 ? undefined : end).includes(`\n  '${version}': {`)) throw new Error(`changelog already has ${version}`);
  const card = [
    `  '${version}': {`,
    `    title: ${q(entry.title)},`,
    '    changes: [',
    ...entry.changes.map((c) => `      { type: '${c.type}', text: ${q(c.text)} },`),
    '    ],',
    '  },',
    '',
  ].join('\n');
  const cut = at + marker.length;
  return source.slice(0, cut) + card + source.slice(cut);
}

/** version.ts with the new LATEST_VERSION and the matching DISPLAY_VERSION ("VinaX V2 <major>.<minor>"). */
export function updateVersionTs(source, version) {
  const [major, minor] = version.split('.');
  let out = source.replace(/export const LATEST_VERSION = '[^']+';/, `export const LATEST_VERSION = '${version}';`);
  out = out.replace(/export const DISPLAY_VERSION = '[^']*';/, `export const DISPLAY_VERSION = 'VinaX V2 ${major}.${minor}';`);
  if (!out.includes(`'${version}'`)) throw new Error('LATEST_VERSION not found in version.ts');
  return out;
}

/** package.json / package-lock.json with the root version replaced (the lock has it twice). */
export function updatePackageJson(source, version) {
  const first = source.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  // package-lock.json: the root package entry under "packages" > "" repeats it.
  return first.replace(/("packages":\s*\{\s*"":\s*\{\s*(?:"name":\s*"[^"]*",\s*)?"version":\s*")[^"]+(")/, `$1${version}$2`);
}

// ------------------------------------------------------------------ CLI

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

export function main(argv = process.argv.slice(2)) {
  const dry = argv.includes('--dry-run');
  const message = process.env.RELEASE_COMMIT_MESSAGE ?? git('log', '-1', '--format=%B');
  // The merged pull request's "<title>\n\n<description>", found by the workflow (empty when there is none).
  const prMessage = process.env.RELEASE_PR_MESSAGE ?? '';
  const pkgPath = join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const current = pkg.version;

  const directive = directiveOfMerge(message, prMessage);
  if (directive === 'skip') return done('skipped', `the merge asked to skip the release; staying at ${current}`);
  // A merge that already bumped the version is a manual release: leave it.
  let before = null;
  try { before = JSON.parse(git('show', 'HEAD~1:frontend/package.json')).version; } catch { /* first commit or shallow */ }
  if (before && before !== current) return done('manual', `the merge already moved the version ${before} → ${current}; nothing to bump`);

  const level = directive;
  const next = bumpVersion(current, level);
  const entry = entryFromMessage(cardMessage(message, prMessage));
  const files = {
    'package.json': (s) => updatePackageJson(s, next),
    'package-lock.json': (s) => updatePackageJson(s, next),
    'src/constants/version.ts': (s) => updateVersionTs(s, next),
    'src/constants/changelog.ts': (s) => insertChangelogEntry(s, next, entry),
  };
  for (const [rel, edit] of Object.entries(files)) {
    const p = join(ROOT, rel);
    const out = edit(readFileSync(p, 'utf8'));
    if (!dry) writeFileSync(p, out);
  }
  return done('bumped', `${current} → ${next} (${level}): ${entry.title}`, { version: next, level, entry });
}

function done(status, text, extra = {}) {
  const result = { status, text, ...extra };
  console.log(`auto-release: ${status} — ${text}`);
  // Visible in the run's annotations, where the log itself may not be.
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=auto-release ${status}::${text}`);
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `status=${status}\nversion=${extra.version ?? ''}\ntitle=${(extra.entry?.title ?? '').replace(/\n/g, ' ')}\n`, { flag: 'a' });
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
