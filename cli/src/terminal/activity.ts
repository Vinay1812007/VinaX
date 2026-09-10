/**
 * Activity lines: the animated "doing something" state, and the permanent
 * record it leaves behind.
 *
 * Two rules shape this:
 *
 *  1. An in-progress activity is TRANSIENT. It redraws one line in place and
 *     leaves nothing in scrollback. A spinner that prints a new line per frame
 *     fills a terminal with hundreds of dead frames.
 *  2. A finished activity is PERMANENT and factual: what happened, and how
 *     long it took. `✓ Ran npm test · 3.2s`, not a spinner frozen mid-frame.
 *
 * The clock is injectable so the tests can advance time deterministically —
 * asserting spinner behaviour against real timers is how test suites become
 * slow and flaky.
 */

export type ActivityState = 'running' | 'ok' | 'failed' | 'interrupted';

export interface ActivityView {
  /** Text without the leading mark. */
  text: string;
  state: ActivityState;
  /** Current spinner glyph while running. */
  frame: string;
  /** Milliseconds since it started. */
  elapsedMs: number;
}

/** Injectable time source — monotonic, never wall-clock. */
export interface Clock {
  now(): number;
}

export const monotonicClock: Clock = {
  // performance.now() is monotonic; Date.now() jumps when the system clock is
  // adjusted, which would show a command as taking minus four seconds.
  now: () => performance.now(),
};

/** Restrained braille spinner. */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
/** For terminals that cannot draw braille. */
export const ASCII_FRAMES = ['-', '\\', '|', '/'] as const;

export interface ActivityOptions {
  clock?: Clock;
  frames?: readonly string[];
  /** Milliseconds between frames. */
  interval?: number;
}

export class Activity {
  private readonly clock: Clock;
  private readonly frames: readonly string[];
  readonly interval: number;
  private startedAt: number;
  private endedAt: number | null = null;
  private tick = 0;
  private label: string;
  private result: ActivityState = 'running';

  constructor(label: string, opts: ActivityOptions = {}) {
    this.clock = opts.clock ?? monotonicClock;
    this.frames = opts.frames ?? SPINNER_FRAMES;
    this.interval = opts.interval ?? 80;
    this.label = label;
    this.startedAt = this.clock.now();
  }

  get state(): ActivityState {
    return this.result;
  }

  get running(): boolean {
    return this.result === 'running';
  }

  get text(): string {
    return this.label;
  }

  setLabel(label: string): void {
    this.label = label;
  }

  /** Advance the spinner. Ignored once finished, so a stopped activity can
   *  never keep writing frames. */
  advance(): void {
    if (!this.running) return;
    this.tick += 1;
  }

  get frame(): string {
    return this.frames[this.tick % this.frames.length];
  }

  elapsedMs(): number {
    return (this.endedAt ?? this.clock.now()) - this.startedAt;
  }

  finish(state: Exclude<ActivityState, 'running'>, label?: string): void {
    if (!this.running) return;
    this.result = state;
    this.endedAt = this.clock.now();
    if (label) this.label = label;
  }

  view(): ActivityView {
    return { text: this.label, state: this.result, frame: this.frame, elapsedMs: this.elapsedMs() };
  }
}

/**
 * Human elapsed time.
 *
 * Sub-second work gets no duration at all: `✓ Read src/auth.ts · 0.0s` is
 * noise that makes the useful durations harder to see.
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return '';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Turn a tool call into the activity line a person wants to read.
 *
 * `read_file {"path":"src/auth.ts"}` is what the protocol carries; "Reading
 * src/auth.ts" is what belongs on screen. Raw arguments appear only under
 * --debug.
 */
export function describeTool(name: string, args: Record<string, unknown>): string {
  const str = (k: string): string => (typeof args[k] === 'string' ? (args[k] as string) : '');
  const list = (k: string): string[] => (Array.isArray(args[k]) ? (args[k] as unknown[]).filter((x): x is string => typeof x === 'string') : []);
  const base = (p: string): string => p.split('/').pop() || p;

  switch (name) {
    case 'read_file': return `Reading ${str('path')}`;
    case 'read_file_range': return `Reading ${str('path')}`;
    case 'read_files': {
      const n = list('paths').length;
      return n === 1 ? `Reading ${list('paths')[0]}` : `Reading ${n} files`;
    }
    case 'file_stat': return `Inspecting ${str('path')}`;
    case 'list_directory': return `Inspecting ${str('path') || 'the workspace'}`;
    case 'directory_tree': return `Mapping ${str('path') || 'the workspace'}`;
    case 'glob': return `Finding ${str('pattern')}`;
    case 'search_files': return `Finding files like "${str('query')}"`;
    case 'grep': return `Searching for "${str('pattern')}"`;
    case 'create_directory': return `Creating ${str('path')}/`;
    case 'write_file': return `Writing ${str('path')}`;
    case 'apply_patch': return `Editing ${str('path')}`;
    case 'move_file': return `Moving ${base(str('from'))} to ${str('to')}`;
    case 'copy_file': return `Copying ${base(str('from'))} to ${str('to')}`;
    case 'delete_file': return `Deleting ${str('path')}`;
    case 'run_command': {
      const argv = [str('command'), ...list('args')].join(' ').trim();
      return `Running ${argv || 'a command'}`;
    }
    case 'run_shell': return `Running ${str('command')}`;
    case 'git_status': return 'Checking Git status';
    case 'git_diff': return 'Reviewing changes';
    case 'git_log': return 'Reading history';
    case 'git_branch': return str('create') ? `Creating branch ${str('create')}` : str('checkout') ? `Switching to ${str('checkout')}` : 'Listing branches';
    case 'git_show': return `Showing ${str('ref') || 'HEAD'}`;
    case 'git_add': return `Staging ${list('paths').length} file${list('paths').length === 1 ? '' : 's'}`;
    case 'git_commit': return 'Creating commit';
    case 'git_fetch': return `Fetching from ${str('remote') || 'origin'}`;
    case 'git_pull': return `Pulling from ${str('remote') || 'origin'}`;
    case 'git_push': return `Pushing ${str('branch') || 'the current branch'}`;
    case 'web_search': return `Searching the web for "${str('query')}"`;
    case 'update_plan': return 'Updating the plan';
    default:
      if (name.startsWith('mcp__')) {
        const [, server, tool] = name.split('__');
        return `Running ${tool} on ${server}`;
      }
      return name.replace(/_/g, ' ');
  }
}

/** Past tense for the permanent line a finished activity leaves. */
export function describeToolDone(name: string, args: Record<string, unknown>): string {
  const running = describeTool(name, args);
  return running
    .replace(/^Reading /, 'Read ')
    .replace(/^Inspecting /, 'Inspected ')
    .replace(/^Mapping /, 'Mapped ')
    .replace(/^Finding /, 'Found ')
    .replace(/^Searching for /, 'Searched for ')
    .replace(/^Searching the web for /, 'Searched the web for ')
    .replace(/^Creating branch /, 'Created branch ')
    .replace(/^Creating commit/, 'Created commit')
    .replace(/^Creating /, 'Created ')
    .replace(/^Writing /, 'Wrote ')
    .replace(/^Editing /, 'Updated ')
    .replace(/^Moving /, 'Moved ')
    .replace(/^Copying /, 'Copied ')
    .replace(/^Deleting /, 'Deleted ')
    .replace(/^Running /, 'Ran ')
    .replace(/^Checking /, 'Checked ')
    .replace(/^Reviewing /, 'Reviewed ')
    .replace(/^Staging /, 'Staged ')
    .replace(/^Fetching /, 'Fetched ')
    .replace(/^Pulling /, 'Pulled ')
    .replace(/^Pushing /, 'Pushed ')
    .replace(/^Switching /, 'Switched ')
    .replace(/^Listing /, 'Listed ')
    .replace(/^Showing /, 'Showed ')
    .replace(/^Updating /, 'Updated ');
}
