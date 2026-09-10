/**
 * The runtime task ledger — what VinaX is doing, as fact rather than
 * narration.
 *
 * Everything here is observed: a file was read, a command exited 1, a commit
 * produced a hash. None of it is the model's internal reasoning, and none of
 * it is a guess about what happens next. `/status` renders this, and the
 * final summary is built from it, which is what makes the summary trustworthy
 * — it reports what the tools did, not what the reply claimed.
 */

export type TaskState =
  | 'Planning'
  | 'Inspecting'
  | 'Reading'
  | 'Searching'
  | 'Editing'
  | 'Running command'
  | 'Testing'
  | 'Waiting for approval'
  | 'Checking Git'
  | 'Committing'
  | 'Pushing'
  | 'Completed'
  | 'Interrupted'
  | 'Blocked'
  | 'Failed';

export interface PlanStep {
  text: string;
  status: 'done' | 'doing' | 'todo';
}

export interface CommandRecord {
  command: string;
  exitCode: number | null;
  ms: number;
  /** A one-line summary of the outcome, e.g. "47 passed". */
  summary: string;
}

export class TaskLedger {
  goal = '';
  state: TaskState = 'Planning';
  plan: PlanStep[] = [];
  readonly filesRead = new Set<string>();
  readonly filesChanged = new Set<string>();
  readonly commands: CommandRecord[] = [];
  readonly commits: Array<{ hash: string; message: string }> = [];
  readonly pushes: Array<{ remote: string; branch: string; ok: boolean; detail: string }> = [];
  readonly blockers: string[] = [];
  branch = '';
  steps = 0;
  toolCalls = 0;
  inputTokens = 0;
  outputTokens = 0;
  startedAt = Date.now();

  setState(state: TaskState): void {
    this.state = state;
  }

  /** Replace the plan wholesale — the model always sends the full list. */
  setPlan(goal: string, steps: string[]): void {
    if (goal) this.goal = goal;
    this.plan = steps.map((raw) => {
      const m = /^(done|doing|todo)\s*:\s*(.*)$/i.exec(raw.trim());
      if (!m) return { text: raw.trim(), status: 'todo' as const };
      return { text: m[2].trim(), status: m[1].toLowerCase() as PlanStep['status'] };
    });
  }

  recordCommand(rec: CommandRecord): void {
    this.commands.push(rec);
  }

  /** The most useful line to show for a finished run's validation section. */
  latestValidation(): CommandRecord | null {
    for (let i = this.commands.length - 1; i >= 0; i -= 1) {
      const c = this.commands[i];
      if (/\b(test|spec|check|lint|build|typecheck|vitest|jest|pytest|cargo|go)\b/i.test(c.command)) return c;
    }
    return this.commands[this.commands.length - 1] ?? null;
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }
}

/**
 * Read an exit code and some output, and say what happened in one line.
 *
 * Test runners all report differently and none of them are going to agree, so
 * this reads the shapes that actually turn up. When nothing matches it says
 * so plainly rather than inventing a number — "exit 0" is a fact, "47 tests
 * passed" would be a fabrication.
 */
export function summarizeRun(exitCode: number | null, output: string): string {
  const tail = output.slice(-4000);
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [/Tests\s+(\d+)\s+failed[^\n]*?\|\s*(\d+)\s+passed/i, (m) => `${m[1]} failed, ${m[2]} passed`],
    [/Tests\s+(\d+)\s+passed/i, (m) => `${m[1]} passed`],
    [/(\d+)\s+passing/i, (m) => `${m[1]} passing`],
    [/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed/i, (m) => `${m[1]} failed, ${m[2]} passed`],
    [/Tests:\s+(\d+)\s+passed/i, (m) => `${m[1]} passed`],
    [/(\d+)\s+passed,\s+(\d+)\s+failed/i, (m) => `${m[1]} passed, ${m[2]} failed`],
    [/=+\s*(\d+)\s+failed,\s*(\d+)\s+passed/i, (m) => `${m[1]} failed, ${m[2]} passed`],
    [/=+\s*(\d+)\s+passed/i, (m) => `${m[1]} passed`],
    [/ok\s+(\d+)\s+passed;\s+(\d+)\s+failed/i, (m) => `${m[1]} passed, ${m[2]} failed`],
    [/(\d+)\s+problems?\s*\((\d+)\s+errors?/i, (m) => `${m[2]} lint errors`],
  ];
  for (const [re, fmt] of patterns) {
    const m = tail.match(re);
    if (m) return fmt(m);
  }
  if (exitCode === 0) return 'exit 0';
  if (exitCode === null) return 'did not finish';
  return `exit ${exitCode}`;
}

/** Short label for the terminal while a command runs. */
export function commandLabel(command: string, args: string[] = []): string {
  const full = [command, ...args].join(' ');
  return full.length > 72 ? `${full.slice(0, 69)}…` : full;
}
