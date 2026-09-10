/**
 * Command-line parsing.
 *
 * The concepts are kept apart on purpose, because conflating them is the
 * classic way a coding CLI becomes unusable:
 *
 *   engine    which VinaX engine answers            --engine
 *   model     which model, on engines that take one --model
 *   approval  how much VinaX may do unattended      --approval
 *   web       whether live web search is available  --web
 *   output    interactive, print, or JSON events    -p / --json
 *
 * There is deliberately no `--mode`. It would have to mean one of those four
 * and would be misread as the other three.
 */
import { EXIT } from '../utils/exit.js';

export type ApprovalMode = 'ask' | 'auto-edit' | 'full-auto';
export type OutputMode = 'interactive' | 'text' | 'json';

export type Command =
  | { kind: 'run' }
  | { kind: 'exec' }
  | { kind: 'models' }
  | { kind: 'sessions' }
  | { kind: 'doctor' }
  | { kind: 'mcp'; action: 'list' | 'add' | 'remove'; rest: string[] }
  | { kind: 'help' }
  | { kind: 'version' };

export interface ParsedArgs {
  command: Command;
  /** The prompt, from -p/--print, from `exec`, or from a bare argument. */
  prompt: string | null;
  cwd: string | null;
  addDirs: string[];
  engine: string | null;
  model: string | null;
  web: boolean | null;
  approval: ApprovalMode | null;
  maxSteps: number | null;
  continueLast: boolean;
  resumeId: string | null;
  output: OutputMode;
  debug: boolean;
  color: boolean | null;
  /** Populated instead of throwing, so main() can print and exit cleanly. */
  error: string | null;
}

const APPROVALS: ApprovalMode[] = ['ask', 'auto-edit', 'full-auto'];

function empty(): ParsedArgs {
  return {
    command: { kind: 'run' },
    prompt: null,
    cwd: null,
    addDirs: [],
    engine: null,
    model: null,
    web: null,
    approval: null,
    maxSteps: null,
    continueLast: false,
    resumeId: null,
    output: 'interactive',
    debug: false,
    color: null,
    error: null,
  };
}

/** Parse argv (without node and the script path). */
export function parseArgs(argv: string[]): ParsedArgs {
  const out = empty();
  const positional: string[] = [];
  let explicitOutput = false;
  let i = 0;

  const need = (flag: string): string | null => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('-')) {
      out.error = `${flag} needs a value`;
      return null;
    }
    i += 1;
    return v;
  };

  for (; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith('-')) {
      positional.push(a);
      continue;
    }
    switch (a) {
      case '-h':
      case '--help':
        out.command = { kind: 'help' };
        return out;
      case '-v':
      case '--version':
        out.command = { kind: 'version' };
        return out;
      case '-p':
      case '--print': {
        const v = need(a);
        if (v === null) return out;
        out.prompt = v;
        if (!explicitOutput) out.output = 'text';
        break;
      }
      case '--json':
        out.output = 'json';
        explicitOutput = true;
        break;
      case '--cwd': {
        const v = need(a);
        if (v === null) return out;
        out.cwd = v;
        break;
      }
      case '--add-dir': {
        const v = need(a);
        if (v === null) return out;
        out.addDirs.push(v);
        break;
      }
      case '--engine': {
        const v = need(a);
        if (v === null) return out;
        out.engine = v;
        break;
      }
      case '--model': {
        const v = need(a);
        if (v === null) return out;
        out.model = v;
        break;
      }
      case '--web':
        out.web = true;
        break;
      case '--no-web':
        out.web = false;
        break;
      case '--approval': {
        const v = need(a);
        if (v === null) return out;
        if (!APPROVALS.includes(v as ApprovalMode)) {
          out.error = `--approval must be one of ${APPROVALS.join(', ')}`;
          return out;
        }
        out.approval = v as ApprovalMode;
        break;
      }
      // Shorthands for the three approval modes.
      case '--ask':
        out.approval = 'ask';
        break;
      case '--auto-edit':
        out.approval = 'auto-edit';
        break;
      case '--full-auto':
        out.approval = 'full-auto';
        break;
      case '--max-steps': {
        const v = need(a);
        if (v === null) return out;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 500) {
          out.error = '--max-steps must be a whole number between 1 and 500';
          return out;
        }
        out.maxSteps = n;
        break;
      }
      case '-c':
      case '--continue':
        out.continueLast = true;
        break;
      case '--resume': {
        const v = need(a);
        if (v === null) return out;
        out.resumeId = v;
        break;
      }
      case '--debug':
        out.debug = true;
        break;
      case '--no-color':
        out.color = false;
        break;
      case '--color':
        out.color = true;
        break;
      default:
        out.error = `unknown option ${a}`;
        return out;
    }
  }

  // Subcommands claim the first positional; everything else is prompt text.
  const first = positional[0];
  switch (first) {
    case 'exec':
      out.command = { kind: 'exec' };
      out.prompt = positional.slice(1).join(' ') || out.prompt;
      if (!explicitOutput) out.output = 'text';
      break;
    case 'models':
      out.command = { kind: 'models' };
      break;
    case 'sessions':
      out.command = { kind: 'sessions' };
      break;
    case 'doctor':
      out.command = { kind: 'doctor' };
      break;
    case 'mcp': {
      const action = positional[1];
      if (action !== 'list' && action !== 'add' && action !== 'remove') {
        out.error = 'vinax mcp takes list, add or remove';
        return out;
      }
      out.command = { kind: 'mcp', action, rest: positional.slice(2) };
      break;
    }
    case 'help':
      out.command = { kind: 'help' };
      break;
    case 'version':
      out.command = { kind: 'version' };
      break;
    default:
      // An explicit -p wins: positionals after it (or after --) are extra
      // words, not a replacement prompt.
      if (positional.length && out.prompt === null) out.prompt = positional.join(' ');
      break;
  }

  // A bare prompt on an interactive terminal still runs one turn and exits;
  // that is what `vinax "explain this repo"` is expected to do.
  if (out.command.kind === 'run' && out.prompt && out.output === 'interactive') {
    out.output = 'text';
  }
  if (out.continueLast && out.resumeId) {
    out.error = '--continue and --resume name different sessions; pick one';
  }
  return out;
}

/** Exit code for a parse failure — always the usage code. */
export const USAGE_EXIT = EXIT.usage;
