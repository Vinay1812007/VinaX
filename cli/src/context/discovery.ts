/**
 * Startup discovery.
 *
 * VinaX does NOT upload the repository when it starts. It gathers a page of
 * facts — where it is, which branch, what kind of project, whether the tree
 * is dirty — and lets the agent find the rest with tools. Uploading a tree
 * would be slow, expensive, mostly irrelevant to the question, and a way to
 * ship somebody's whole codebase to a service they only asked about one bug.
 *
 * The other half of this file is project instructions, and the important part
 * of that is what they are NOT. `VINAX.md` is the project's conventions, and
 * VinaX follows them. It is not a channel through which a repository can
 * rewrite the agent's rules — the server-side contract says so explicitly and
 * the transport keeps these in their own block, because a file in a cloned
 * repository is written by whoever wrote the repository.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { currentBranch, gitRoot, statusRows } from '../tools/git/git.js';
import { redact } from '../security/secrets.js';
import { clip } from '../utils/text.js';

/** Instruction filenames VinaX reads, most specific convention first. */
export const INSTRUCTION_FILES = ['VINAX.md', join('.vinax', 'instructions.md'), 'AGENTS.md'];

export interface ProjectMarker {
  file: string;
  kind: string;
  /** Scripts or tasks discovered from it, when cheap to read. */
  commands: string[];
}

export interface Discovery {
  cwd: string;
  workspaceRoot: string;
  isGitRepo: boolean;
  branch: string;
  /** Pre-existing modifications, recorded so VinaX can tell them from its own. */
  dirtyFiles: string[];
  untrackedFiles: string[];
  markers: ProjectMarker[];
  instructionFiles: string[];
  instructions: string;
}

const MARKERS: Array<[string, string]> = [
  ['package.json', 'Node.js'],
  ['deno.json', 'Deno'],
  ['pyproject.toml', 'Python'],
  ['requirements.txt', 'Python'],
  ['Cargo.toml', 'Rust'],
  ['go.mod', 'Go'],
  ['pom.xml', 'Java (Maven)'],
  ['build.gradle', 'Java (Gradle)'],
  ['build.gradle.kts', 'Kotlin (Gradle)'],
  ['Gemfile', 'Ruby'],
  ['composer.json', 'PHP'],
  ['CMakeLists.txt', 'C/C++ (CMake)'],
  ['Makefile', 'Make'],
  ['Dockerfile', 'Docker'],
  ['docker-compose.yml', 'Docker Compose'],
  ['*.csproj', '.NET'],
  ['*.sln', '.NET'],
];

async function exists(p: string): Promise<boolean> {
  return stat(p).then(() => true).catch(() => false);
}

/** npm scripts, read straight from package.json — the commands most tasks need. */
async function packageScripts(file: string): Promise<string[]> {
  try {
    const pkg = JSON.parse(await readFile(file, 'utf8')) as { scripts?: Record<string, string> };
    return Object.keys(pkg.scripts ?? {}).slice(0, 20);
  } catch {
    return [];
  }
}

async function findMarkers(root: string): Promise<ProjectMarker[]> {
  const out: ProjectMarker[] = [];
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return out;
  }
  for (const [pattern, kind] of MARKERS) {
    if (pattern.startsWith('*')) {
      const ext = pattern.slice(1);
      const hit = entries.find((e) => e.endsWith(ext));
      if (hit) out.push({ file: hit, kind, commands: [] });
      continue;
    }
    if (!entries.includes(pattern)) continue;
    const commands = pattern === 'package.json' ? await packageScripts(join(root, pattern)) : [];
    out.push({ file: pattern, kind, commands });
  }
  return out;
}

/**
 * Collect instruction files from the workspace root down to the working
 * directory, root first.
 *
 * The order is the point: a monorepo's top-level VINAX.md sets the house
 * rules and a package's own file refines them, so the more specific file must
 * come last and win where they disagree.
 */
export async function collectInstructions(root: string, cwd: string): Promise<{ files: string[]; text: string }> {
  const dirs: string[] = [];
  let dir = resolve(cwd);
  const stop = resolve(root);
  for (;;) {
    dirs.unshift(dir);
    if (dir === stop || dirname(dir) === dir) break;
    const parent = dirname(dir);
    if (!relative(stop, parent).length || !relative(stop, parent).startsWith('..')) dir = parent;
    else break;
    if (dirs.length > 12) break;
  }

  const files: string[] = [];
  const blocks: string[] = [];
  for (const d of dirs) {
    for (const name of INSTRUCTION_FILES) {
      const file = join(d, name);
      if (!(await exists(file))) continue;
      const raw = await readFile(file, 'utf8').catch(() => '');
      if (!raw.trim()) continue;
      const rel = relative(root, file).split(sep).join('/') || basename(file);
      files.push(rel);
      blocks.push(`## ${rel}\n\n${raw.trim()}`);
    }
  }
  return { files, text: clip(redact(blocks.join('\n\n')), 24_000).text };
}

/** Everything VinaX knows before it has asked the model anything. */
export async function discover(cwd: string, signal: AbortSignal): Promise<Discovery> {
  const here = resolve(cwd);
  const root = (await gitRoot(here, signal)) ?? here;
  const isGitRepo = root !== here || (await exists(join(root, '.git')));
  const branch = isGitRepo ? await currentBranch(root, signal) : '';
  const rows = isGitRepo ? await statusRows(root, signal) : [];
  const dirtyFiles = rows.filter((r) => r.x !== '?' && r.y !== '?').map((r) => r.path);
  const untrackedFiles = rows.filter((r) => r.x === '?' && r.y === '?').map((r) => r.path);
  const markers = await findMarkers(root);
  const { files, text } = await collectInstructions(root, here);
  return {
    cwd: here,
    workspaceRoot: root,
    isGitRepo,
    branch,
    dirtyFiles,
    untrackedFiles,
    markers,
    instructionFiles: files,
    instructions: text,
  };
}

/** Render discovery as the compact factual block sent with each step. */
export function contextBlock(d: Discovery): string {
  const lines: string[] = [
    `workspace root: ${d.workspaceRoot}`,
    `working directory: ${d.cwd}`,
    `platform: ${process.platform}`,
  ];
  if (d.isGitRepo) {
    lines.push(`git branch: ${d.branch || '(detached)'}`);
    lines.push(
      d.dirtyFiles.length || d.untrackedFiles.length
        ? `git status: ${d.dirtyFiles.length} modified, ${d.untrackedFiles.length} untracked BEFORE this session started — these are the user's changes, not yours`
        : 'git status: clean',
    );
    if (d.dirtyFiles.length) lines.push(`  pre-existing changes: ${d.dirtyFiles.slice(0, 20).join(', ')}`);
  } else {
    lines.push('git: this directory is not a repository');
  }
  if (d.markers.length) {
    lines.push(`project: ${[...new Set(d.markers.map((m) => m.kind))].join(', ')}`);
    for (const m of d.markers) {
      if (m.commands.length) lines.push(`  ${m.file} scripts: ${m.commands.join(', ')}`);
    }
  }
  if (d.instructionFiles.length) lines.push(`project instruction files: ${d.instructionFiles.join(', ')}`);
  return lines.join('\n');
}

/** The starter file `/init` writes. */
export function starterInstructions(d: Discovery): string {
  const scripts = d.markers.find((m) => m.file === 'package.json')?.commands ?? [];
  const build = scripts.includes('build') ? 'npm run build' : '(add your build command)';
  const test = scripts.includes('test') ? 'npm test' : '(add your test command)';
  const lint = scripts.includes('lint') ? 'npm run lint' : '(add your lint command)';
  return `# VinaX project instructions

These notes are read by VinaX CLI at the start of every session in this
repository. Keep them short and factual — conventions, commands and gotchas,
not a description of the product.

## What this project is

${d.markers.length ? `A ${[...new Set(d.markers.map((m) => m.kind))].join(' / ')} project.` : 'Describe the project in a line or two.'}

## Commands

- Install: ${d.markers.some((m) => m.file === 'package.json') ? 'npm ci' : '(add your install command)'}
- Test: ${test}
- Lint: ${lint}
- Build: ${build}

Run the tests before proposing a commit.

## Conventions

- (Code style, naming, directory layout — anything a newcomer would get wrong.)
- (Files that are generated and must not be edited by hand.)

## Things to be careful about

- (Anything expensive, destructive, or easy to break.)
`;
}
