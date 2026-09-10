/**
 * The approval prompt.
 *
 * A prompt has to say what will actually happen, or it is theatre. So it
 * shows the real command and working directory; the real diff, not a summary
 * of one; the real remote, branch and commit count. Then the user chooses
 * with the arrow keys, like every other selector in VinaX.
 *
 * Two invariants the tests hold:
 *
 *  - The safe answer is what you get by NOT deciding. Esc and Ctrl+C both
 *    reject, and the default selection is the least dangerous option.
 *  - A high-impact action is never offered a blanket session grant. "Allow
 *    everything like this from now on" is not a reasonable thing to click
 *    past for `sudo` or a force push.
 *
 * Non-interactive runs never reach here: the policy turns an unanswerable
 * question into a structured refusal instead.
 */
import type { ActionRequest, Prompter } from '../permissions/policy.js';
import type { MenuItem } from './menu.js';
import type { TerminalApp } from './app.js';

export type Answer = 'once' | 'session' | 'reject';

/** The choices offered for one request, safest-first where it matters. */
export function approvalItems(req: ActionRequest): Array<MenuItem<Answer>> {
  const items: Array<MenuItem<Answer>> = [
    { id: 'once', label: req.risk === 'critical' ? 'Allow this once' : 'Allow once', value: 'once' },
  ];
  // A critical action earns no session grant, in any mode.
  if (req.risk !== 'critical') {
    items.push({ id: 'session', label: req.scopeLabel, value: 'session' });
  }
  items.push({ id: 'reject', label: 'Reject', value: 'reject' });
  return items;
}

/** The body shown above the choices. */
export function approvalDetail(req: ActionRequest): string[] {
  const detail = [...req.detail];
  if (req.risk === 'critical') {
    detail.push('', 'This is a high-impact action. VinaX asks about these in every mode.');
  }
  return detail;
}

/**
 * Build the interactive prompter.
 *
 * `y` and `n` remain available as shortcuts because they are unambiguous and
 * faster than arrowing for the common case.
 */
export function createPrompter(app: TerminalApp): Prompter {
  return async (req: ActionRequest): Promise<Answer> => {
    const choice = await app.choose<Answer>({
      title: req.title,
      items: approvalItems(req),
      detail: approvalDetail(req),
      hint: '↑↓ navigate · Enter confirm · y allow · n reject · Esc reject',
      shortcuts: { y: 'once', n: 'reject' },
      maxVisible: 4,
    });
    // Esc, Ctrl+C and anything unrecognised all mean no. The safe answer must
    // be the one you get by not deciding.
    return choice ?? 'reject';
  };
}
