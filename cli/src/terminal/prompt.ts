/**
 * The approval prompt.
 *
 * A prompt has to say what will actually happen, or it is theatre. So it
 * shows the real command and the real working directory; the real diff, not a
 * summary of one; the real remote and branch and how many commits. Then three
 * clear answers, with the middle one — a session grant — scoped to the kind
 * of action rather than to everything.
 *
 * Only ever called when there is a TTY. Non-interactive runs never reach here:
 * the policy turns an unanswerable question into a structured refusal.
 */
import { createInterface, type Interface } from 'node:readline';
import type { ActionRequest, Prompter } from '../permissions/policy.js';
import { glyphs, paint, renderDiff, type Theme } from './render.js';

function looksLikeDiff(lines: string[]): boolean {
  return lines.some((l) => l.startsWith('@@') || l.startsWith('+') || l.startsWith('-'));
}

export function renderRequest(req: ActionRequest, theme: Theme): string {
  const g = glyphs(theme);
  const out: string[] = ['', `${paint(theme, 'yellow', g.ask)} ${paint(theme, 'bold', req.title)}`, ''];
  const body = looksLikeDiff(req.detail) ? renderDiff(req.detail.join('\n'), theme).split('\n') : req.detail.map((l) => `  ${l}`);
  out.push(...body);
  if (req.risk === 'critical') {
    out.push('', paint(theme, 'red', '  This is a high-impact action. VinaX asks about these in every mode.'));
  }
  out.push('');
  out.push(`  1. ${req.risk === 'critical' ? 'Allow this once' : 'Allow once'}`);
  // A critical action never earns a blanket session grant — that is the
  // difference between "you approved this" and "you approved this class of
  // thing forever".
  if (req.risk !== 'critical') out.push(`  2. ${req.scopeLabel}`);
  out.push(`  ${req.risk === 'critical' ? '2' : '3'}. Reject`);
  out.push('');
  return out.join('\n');
}

/** Build a prompter bound to a readline interface the caller owns. */
export function createPrompter(theme: Theme, ask: (question: string) => Promise<string>): Prompter {
  return async (req: ActionRequest): Promise<'once' | 'session' | 'reject'> => {
    process.stdout.write(`${renderRequest(req, theme)}\n`);
    const rejectKey = req.risk === 'critical' ? '2' : '3';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const answer = (await ask(`  Choose 1-${rejectKey} (default ${rejectKey}, reject): `)).trim().toLowerCase();
      // A bare Enter, or anything unrecognised after three tries, means no.
      // The safe answer must be the one you get by not deciding.
      if (!answer) return 'reject';
      if (answer === '1' || answer === 'y' || answer === 'yes' || answer === 'once') return 'once';
      if (req.risk !== 'critical' && (answer === '2' || answer === 'a' || answer === 'always' || answer === 'session')) return 'session';
      if (answer === rejectKey || answer === 'n' || answer === 'no' || answer === 'r' || answer === 'reject') return 'reject';
      process.stdout.write(paint(theme, 'grey', `  Please answer 1-${rejectKey}.\n`));
    }
    return 'reject';
  };
}

/** A readline-backed question function for a standalone (non-REPL) prompt. */
export function standaloneAsk(): { ask: (q: string) => Promise<string>; close: () => void } {
  let rl: Interface | null = null;
  const ask = (q: string): Promise<string> => {
    if (!rl) rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise<string>((resolve) => (rl as Interface).question(q, resolve));
  };
  return { ask, close: () => rl?.close() };
}
