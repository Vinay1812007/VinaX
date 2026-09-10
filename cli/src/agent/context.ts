/**
 * Context management.
 *
 * A long coding session outgrows any context window: forty tool results, each
 * a file or a test log, and the early turns stop fitting. The wrong fix is to
 * drop the oldest messages, because the oldest message is usually the one
 * that said what the user actually wanted.
 *
 * So compaction is structured. What survives is the objective, the
 * constraints, what changed, what was run and what it said, what is still
 * broken, and the permission decisions worth remembering. What goes is the
 * bulk: file contents already read, verbose command output, superseded turns.
 *
 * No hidden reasoning is preserved, because none is ever received.
 */
import type { TaskLedger } from './ledger.js';

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/** A rough token estimate. Cheap, and only ever used to decide when to compact. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.7);
}

export function conversationTokens(turns: Turn[]): number {
  return turns.reduce((n, t) => n + estimateTokens(t.content), 0);
}

export interface CompactionResult {
  turns: Turn[];
  /** The summary that replaced the dropped turns, or null if nothing changed. */
  summary: string | null;
  droppedTurns: number;
  tokensBefore: number;
  tokensAfter: number;
}

/**
 * Build the factual summary that stands in for the compacted turns.
 *
 * Everything in it comes from the ledger — observed events — plus the user's
 * own words. Nothing is inferred, so the summary cannot introduce a claim the
 * run never established.
 */
export function buildSummary(turns: Turn[], ledger: TaskLedger): string {
  const firstUser = turns.find((t) => t.role === 'user')?.content ?? '';
  const recentUser = turns.filter((t) => t.role === 'user').slice(-3).map((t) => t.content);
  const lines: string[] = ['# Session so far (compacted by VinaX — facts only)', ''];

  lines.push('## What the user asked for');
  lines.push(firstUser.slice(0, 1500) || '(not recorded)');
  if (recentUser.length > 1) {
    lines.push('', '## Later instructions');
    for (const u of recentUser.slice(1)) lines.push(`- ${u.slice(0, 400)}`);
  }

  if (ledger.goal || ledger.plan.length) {
    lines.push('', '## Plan');
    if (ledger.goal) lines.push(`Goal: ${ledger.goal}`);
    for (const s of ledger.plan) lines.push(`- [${s.status}] ${s.text}`);
  }

  if (ledger.filesChanged.size) {
    lines.push('', '## Files changed so far');
    for (const f of ledger.filesChanged) lines.push(`- ${f}`);
  }
  if (ledger.filesRead.size) {
    const read = [...ledger.filesRead].slice(0, 40);
    lines.push('', '## Files already read (re-read only if you need them again)');
    lines.push(read.join(', '));
  }
  if (ledger.commands.length) {
    lines.push('', '## Commands run');
    for (const c of ledger.commands.slice(-15)) {
      lines.push(`- ${c.command} → ${c.summary}${c.exitCode === 0 ? '' : ' (FAILED)'}`);
    }
  }
  const failing = ledger.commands.filter((c) => c.exitCode !== null && c.exitCode !== 0);
  if (failing.length) {
    lines.push('', '## Still failing');
    for (const c of failing.slice(-5)) lines.push(`- ${c.command}: ${c.summary}`);
  }
  if (ledger.commits.length) {
    lines.push('', '## Commits');
    for (const c of ledger.commits) lines.push(`- ${c.hash} ${c.message}`);
  }
  if (ledger.pushes.length) {
    lines.push('', '## Pushes');
    for (const p of ledger.pushes) lines.push(`- ${p.remote}/${p.branch}: ${p.ok ? 'succeeded' : 'FAILED'}`);
  }
  if (ledger.blockers.length) {
    lines.push('', '## Unresolved / blocked');
    for (const b of ledger.blockers) lines.push(`- ${b}`);
  }
  if (ledger.branch) lines.push('', `## Git\nbranch: ${ledger.branch}`);
  return lines.join('\n');
}

export interface CompactOptions {
  /** Compact once the conversation passes this estimate. */
  budgetTokens?: number;
  /** How many recent turns to keep verbatim. */
  keepRecent?: number;
  /** Compact regardless of size — what /compact does. */
  force?: boolean;
}

/**
 * Compact a conversation.
 *
 * The first user turn is always kept verbatim alongside the summary: it is
 * the original instruction, and paraphrasing it is how an agent ends up
 * confidently solving a slightly different problem.
 */
export function compact(turns: Turn[], ledger: TaskLedger, opts: CompactOptions = {}): CompactionResult {
  const budget = opts.budgetTokens ?? 120_000;
  const keepRecent = opts.keepRecent ?? 6;
  const before = conversationTokens(turns);
  if (!opts.force && before < budget) {
    return { turns, summary: null, droppedTurns: 0, tokensBefore: before, tokensAfter: before };
  }
  if (turns.length <= keepRecent + 1) {
    return { turns, summary: null, droppedTurns: 0, tokensBefore: before, tokensAfter: before };
  }

  const summary = buildSummary(turns, ledger);
  const firstUserIndex = turns.findIndex((t) => t.role === 'user');
  const head = firstUserIndex === -1 ? [] : [turns[firstUserIndex]];
  const tail = turns.slice(-keepRecent);
  // Never repeat the first turn if it is already inside the kept tail.
  const keptHead = tail.includes(head[0]) ? [] : head;
  const next: Turn[] = [
    ...keptHead,
    { role: 'assistant', content: summary },
    ...tail,
  ];
  const after = conversationTokens(next);
  return {
    turns: next,
    summary,
    droppedTurns: turns.length - next.length + 1,
    tokensBefore: before,
    tokensAfter: after,
  };
}
