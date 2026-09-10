/**
 * The permission policy.
 *
 * Three modes, one decision function, and one principle: the mode controls
 * how much VinaX may do to the PROJECT without asking, never how much it may
 * do to the COMPUTER. `full-auto` is not root.
 *
 *   ask        the default. Ordinary workspace reads happen freely; anything
 *              that changes a file, runs a command, touches the index, writes
 *              to a remote, reads a credential file or leaves the workspace
 *              is confirmed first.
 *   auto-edit  reading and editing project files, and running routine project
 *              commands, stop asking. Remote writes, installs, destructive
 *              commands, credentials and anything outside the workspace still
 *              ask.
 *   full-auto  routine project-local work runs unattended. Privilege
 *              escalation, destructive system commands, credential stores,
 *              remote repository writes and anything outside the workspace
 *              still require an explicit answer — in every mode, including
 *              this one.
 *
 * Non-interactive runs never block on a prompt. A decision of `ask` with no
 * way to ask becomes a structured refusal the caller reports and exits on.
 */
import type { ApprovalMode } from '../config/args.js';
import type { RiskLevel } from '../security/risk.js';

export type ActionKind =
  | 'read'
  | 'protected-read'
  | 'write'
  | 'delete'
  | 'execute'
  | 'shell'
  | 'git-write'
  | 'remote-write'
  | 'outside-workspace'
  | 'network'
  | 'mcp';

export interface ActionRequest {
  kind: ActionKind;
  /** One line, e.g. "Run command?" or "Modify src/api/client.ts?". */
  title: string;
  /** The body of the prompt: the command, the diff, the remote and branch. */
  detail: string[];
  risk: RiskLevel;
  /** Identity for a "allow similar this session" grant. */
  scopeKey: string;
  /** What that grant would be called in the prompt. */
  scopeLabel: string;
}

export type Decision =
  | { outcome: 'allow'; reason: 'mode' | 'session-grant' | 'user' }
  | { outcome: 'deny'; reason: 'user' | 'non-interactive'; message: string };

/** Asks the user. Absent in non-interactive runs. */
export type Prompter = (req: ActionRequest) => Promise<'once' | 'session' | 'reject'>;

export interface PermissionOptions {
  mode: ApprovalMode;
  prompter?: Prompter;
  /** Scope keys pre-granted by configuration or a previous answer. */
  grants?: Iterable<string>;
  /** Called whenever a decision is made, for the session log and the ledger. */
  onDecision?: (req: ActionRequest, decision: Decision) => void;
}

/**
 * Would this action run without asking, in this mode, ignoring grants?
 *
 * Exported because it is the whole policy in one readable place, and because
 * the tests assert it directly rather than through a prompt.
 */
export function autoAllowed(mode: ApprovalMode, kind: ActionKind, risk: RiskLevel): boolean {
  // Never automatic, in any mode. This is the line that makes full-auto safe
  // to offer at all.
  if (risk === 'critical') return false;
  if (kind === 'outside-workspace' || kind === 'protected-read') return false;
  if (kind === 'remote-write') return false;

  if (kind === 'read') return true;

  if (mode === 'ask') return false;

  if (mode === 'auto-edit') {
    if (kind === 'write' || kind === 'delete' || kind === 'git-write') return true;
    // Routine project commands are how you find out whether an edit worked;
    // an auto-edit mode that cannot run the test suite is not much use.
    if ((kind === 'execute' || kind === 'shell') && risk === 'routine') return true;
    return false;
  }

  // full-auto: everything project-local, including installs and network
  // fetches that a build legitimately needs.
  return kind !== 'mcp' ? true : risk === 'routine';
}

export class PermissionEngine {
  private mode: ApprovalMode;
  private prompter?: Prompter;
  private readonly grants: Set<string>;
  private readonly onDecision?: (req: ActionRequest, decision: Decision) => void;
  /** Every decision made this run, for /permissions and the session file. */
  readonly log: Array<{ request: ActionRequest; decision: Decision; at: number }> = [];

  constructor(opts: PermissionOptions) {
    this.mode = opts.mode;
    this.prompter = opts.prompter;
    this.grants = new Set(opts.grants ?? []);
    this.onDecision = opts.onDecision;
  }

  get approvalMode(): ApprovalMode {
    return this.mode;
  }

  setMode(mode: ApprovalMode): void {
    this.mode = mode;
  }

  get interactive(): boolean {
    return Boolean(this.prompter);
  }

  /**
   * Attach the interactive prompter.
   *
   * The engine is constructed WITHOUT one so that a non-interactive run
   * physically cannot block on a question; the interactive session opts in
   * once it owns a readline interface to ask through.
   */
  setPrompter(prompter: Prompter): void {
    this.prompter = prompter;
  }

  grantedScopes(): string[] {
    return [...this.grants];
  }

  /** Pre-grant a scope, e.g. from `/permissions allow push`. */
  grant(scopeKey: string): void {
    this.grants.add(scopeKey);
  }

  async check(req: ActionRequest): Promise<Decision> {
    const decision = await this.decide(req);
    this.log.push({ request: req, decision, at: Date.now() });
    this.onDecision?.(req, decision);
    return decision;
  }

  private async decide(req: ActionRequest): Promise<Decision> {
    if (this.grants.has(req.scopeKey)) return { outcome: 'allow', reason: 'session-grant' };
    if (autoAllowed(this.mode, req.kind, req.risk)) return { outcome: 'allow', reason: 'mode' };

    if (!this.prompter) {
      return {
        outcome: 'deny',
        reason: 'non-interactive',
        message: `${req.title} needs your approval, and this run cannot ask (no interactive terminal).`,
      };
    }
    const answer = await this.prompter(req);
    if (answer === 'reject') {
      return { outcome: 'deny', reason: 'user', message: `${req.title} was rejected.` };
    }
    if (answer === 'session') {
      this.grants.add(req.scopeKey);
      return { outcome: 'allow', reason: 'user' };
    }
    return { outcome: 'allow', reason: 'user' };
  }
}
