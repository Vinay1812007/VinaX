/**
 * Running local commands.
 *
 * This is where a coding agent stops being a chatbot: it runs the user's
 * tests and reads the real output. Everything hard about that is in here.
 *
 * STRUCTURED, NOT SHELL. `run_command` spawns an executable with an argument
 * array and no shell at all, so a filename with a space or a `;` is data
 * rather than syntax. A shell is only used when the model explicitly asked
 * for `run_shell`, and that costs a stricter permission check.
 *
 * BOUNDED OUTPUT. A dev server or a chatty build can emit gigabytes. Output
 * is capped with both ends kept, because the head says what ran and the tail
 * says how it failed.
 *
 * NO ORPHANS. A test runner spawns workers; a dev server spawns a compiler.
 * Killing the direct child leaves those alive, holding ports, forever. So
 * children go into their own process group (or a Windows job, via taskkill
 * /T) and the whole tree is signalled together — on timeout, on Ctrl+C, and
 * on exit.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { clip } from '../../utils/text.js';
import { redact } from '../../security/secrets.js';

export interface RunOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputChars: number;
  shell: boolean;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** Called with every chunk as it arrives, for live terminal output. */
  onOutput?: (chunk: string, source: 'stdout' | 'stderr') => void;
}

export interface RunResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  /** Combined, clipped, redacted — what the model sees. */
  output: string;
  truncated: boolean;
  timedOut: boolean;
  aborted: boolean;
  ms: number;
  /** Set when the executable could not be started at all. */
  spawnError: string | null;
}

/** Every child VinaX has started, so nothing survives the process exiting. */
const live = new Set<ChildProcess>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const cleanup = (): void => {
    for (const child of live) killTree(child, 'SIGKILL');
    live.clear();
  };
  process.once('exit', cleanup);
  // Not `once` on the signals: the interactive UI handles SIGINT itself and
  // may keep running, but any child alive at that moment must still die.
  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);
}

/**
 * Kill a child and everything it started.
 *
 * POSIX: the child was spawned detached, so it leads its own process group
 * and a negative pid signals the whole group. Windows has no groups, so
 * `taskkill /T` walks the tree instead.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).unref();
    } catch {
      child.kill('SIGKILL');
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

/** True when a command is the kind that runs until something stops it. */
export function isLongRunning(command: string, args: string[]): boolean {
  const full = [command, ...args].join(' ').toLowerCase();
  return /\b(dev|serve|serving|start|watch|--watch|-w\b|nodemon|vite\b|next dev|docker compose up|tail -f|webpack serve)\b/.test(full)
    && !/\b(--run|run --|test)\b/.test(full);
}

export async function runProcess(opts: RunOptions): Promise<RunResult> {
  installExitHook();
  const started = Date.now();
  return new Promise<RunResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(opts.command, opts.shell ? [] : opts.args, {
        cwd: opts.cwd,
        // Never `shell: true` for a structured call: the argument array is the
        // whole point of run_command.
        shell: opts.shell ? true : false,
        // A detached child leads its own process group on POSIX, which is what
        // makes killTree able to reach its grandchildren.
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: opts.env ?? process.env,
      });
    } catch (e) {
      resolve({
        exitCode: null, signal: null, stdout: '', stderr: '', output: '',
        truncated: false, timedOut: false, aborted: false, ms: Date.now() - started,
        spawnError: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    live.add(child);

    // Head-and-tail buffers rather than one growing string. A build that
    // emits a gigabyte must not take the CLI's memory with it, and a
    // head-only cap would throw away the stack trace — which is the only part
    // of a failing run anybody wants to read.
    const cap = Math.max(2000, opts.maxOutputChars);
    const buffers = {
      stdout: { head: '', tail: '', bytes: 0 },
      stderr: { head: '', tail: '', bytes: 0 },
    };
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const collect = (source: 'stdout' | 'stderr') => (buf: Buffer): void => {
      const text = buf.toString('utf8');
      opts.onOutput?.(text, source);
      const b = buffers[source];
      b.bytes += text.length;
      const room = cap - b.head.length;
      if (room > 0) {
        b.head += text.slice(0, room);
        const spill = text.slice(room);
        if (spill) b.tail = (b.tail + spill).slice(-cap);
        return;
      }
      b.tail = (b.tail + text).slice(-cap);
    };

    /** Rejoin head and tail, saying honestly what was dropped between them. */
    const assemble = (source: 'stdout' | 'stderr'): string => {
      const b = buffers[source];
      if (!b.tail) return b.head;
      const omitted = b.bytes - b.head.length - b.tail.length;
      return omitted > 0
        ? `${b.head}\n\n… ${omitted.toLocaleString('en-US')} characters omitted by VinaX …\n\n${b.tail}`
        : b.head + b.tail;
    };

    child.stdout?.on('data', collect('stdout'));
    child.stderr?.on('data', collect('stderr'));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, 'SIGTERM');
      // A process that ignores SIGTERM gets three seconds of grace.
      setTimeout(() => killTree(child, 'SIGKILL'), 3000).unref?.();
    }, opts.timeoutMs);

    const onAbort = (): void => {
      aborted = true;
      killTree(child, 'SIGINT');
      setTimeout(() => killTree(child, 'SIGKILL'), 2000).unref?.();
    };
    opts.signal.addEventListener('abort', onAbort, { once: true });

    const finish = (exitCode: number | null, sig: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onAbort);
      live.delete(child);

      const stdout = assemble('stdout');
      const stderr = assemble('stderr');
      const combined = [
        stdout.trim() ? stdout : '',
        stderr.trim() ? (stdout.trim() ? `\n--- stderr ---\n${stderr}` : stderr) : '',
      ].join('');
      const clipped = clip(redact(combined.trim()), opts.maxOutputChars);
      const dropped = buffers.stdout.bytes > buffers.stdout.head.length + buffers.stdout.tail.length
        || buffers.stderr.bytes > buffers.stderr.head.length + buffers.stderr.tail.length;
      resolve({
        exitCode,
        signal: sig,
        stdout,
        stderr,
        output: clipped.text,
        truncated: clipped.truncated || dropped,
        timedOut,
        aborted,
        ms: Date.now() - started,
        spawnError: null,
      });
    };

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onAbort);
      live.delete(child);
      const stdout = assemble('stdout');
      const stderr = assemble('stderr');
      resolve({
        exitCode: null, signal: null, stdout, stderr, output: redact(stderr || stdout),
        truncated: false, timedOut, aborted, ms: Date.now() - started,
        spawnError: e.message,
      });
    });
    child.on('close', (code, sig) => finish(code, sig));
  });
}

/** How many children are still running — used by the shutdown path. */
export function liveChildCount(): number {
  return live.size;
}

/** Kill everything VinaX started. Called on exit and on a second Ctrl+C. */
export function killAllChildren(): void {
  for (const child of live) killTree(child, 'SIGKILL');
  live.clear();
}
