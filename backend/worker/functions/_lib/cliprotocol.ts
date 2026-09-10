/**
 * VinaX CLI wire protocol — `vinax-cli/1`.
 *
 * The CLI is a LOCAL agent: it owns the device, the filesystem and the child
 * processes. The Worker owns the model, the system contract and the tool
 * vocabulary. Everything that crosses between them is described here, in one
 * versioned place, so neither side has to guess what the other accepts.
 *
 * Three rules shape the design:
 *
 *  1. The client never sends a system prompt. The agent contract lives on the
 *     server (see ./cliprompt.ts) and cannot be overridden from the wire — a
 *     client-supplied `system` message is dropped, not honoured.
 *  2. Every tool request a model produces is validated HERE before it is
 *     allowed to reach a device. Unknown name, wrong argument shape,
 *     oversized payload, extra fields: all become recoverable protocol
 *     errors, never local execution.
 *  3. Tool results are DATA. They arrive from files, compilers, logs and web
 *     pages, and any of those can contain text that reads like an
 *     instruction. The prompt says so and the transport keeps them in their
 *     own role so they can never be mistaken for the contract.
 */

export const CLI_PROTOCOL = 'vinax-cli/1';
/** Every protocol id this Worker can still serve. */
export const SUPPORTED_PROTOCOLS: readonly string[] = [CLI_PROTOCOL];

/** Hard ceilings. A CLI run is many inference calls, so every one is bounded. */
export const LIMITS = {
  /** Whole request body. */
  maxBodyBytes: 1_500_000,
  /** Conversation turns kept (oldest dropped first). */
  maxMessages: 80,
  /** One message. */
  maxMessageChars: 60_000,
  /** One tool result fed back to the model. */
  maxToolResultChars: 60_000,
  /** Tool results per step. */
  maxToolResults: 16,
  /** Model steps in one run — the server refuses a step past this. */
  maxSteps: 80,
  /** Tool calls the model may request in a single step. */
  maxCallsPerStep: 6,
  /** Serialized tool arguments. */
  maxToolArgChars: 24_000,
  /** Any single string inside tool arguments (paths, patterns, commands). */
  maxArgStringChars: 8_000,
  /** Project instruction file contents forwarded as project context. */
  maxInstructionChars: 24_000,
  /** Startup context block (cwd, branch, git summary, project markers). */
  maxContextChars: 8_000,
} as const;

/* -------------------------------------------------------------------------- */
/* Tool vocabulary — server-owned                                             */
/* -------------------------------------------------------------------------- */

/** Argument kinds the validator understands. Deliberately small: a tool
 *  argument is a string, a bounded number, a boolean, or a string array. */
type ArgType = 'string' | 'number' | 'boolean' | 'string[]';

export interface ToolArg {
  type: ArgType;
  required?: boolean;
  /** Human description — goes into the model-facing tool listing. */
  desc: string;
  /** Numeric bounds (numbers only). */
  min?: number;
  max?: number;
  /** Allowed values (strings only). */
  enum?: readonly string[];
}

export interface ToolSpec {
  name: string;
  /** What it does, in the words the model reads. */
  desc: string;
  args: Record<string, ToolArg>;
  /** Side-effect class — drives the CLI's permission policy and the honest
   *  "this changes something" language in the model-facing listing. */
  effect: 'read' | 'write' | 'execute' | 'network';
}

/**
 * Every tool a VinaX CLI client is expected to implement. The server never
 * executes any of them; it validates requests for them and hands them to the
 * device, which applies its own permission policy on top.
 */
export const CLI_TOOLS: readonly ToolSpec[] = [
  // ---- filesystem: read ---------------------------------------------------
  {
    name: 'read_file',
    desc: 'Read one workspace file as UTF-8 text. Returns content plus a stable hash you must quote back when editing it.',
    effect: 'read',
    args: {
      path: { type: 'string', required: true, desc: 'Workspace-relative path.' },
    },
  },
  {
    name: 'read_files',
    desc: 'Read several workspace files in one call. Prefer this over repeated read_file when inspecting a set of related files.',
    effect: 'read',
    args: {
      paths: { type: 'string[]', required: true, desc: 'Workspace-relative paths (max 20).' },
    },
  },
  {
    name: 'read_file_range',
    desc: 'Read a line range of a file (1-indexed, inclusive). Use for large files instead of reading the whole thing.',
    effect: 'read',
    args: {
      path: { type: 'string', required: true, desc: 'Workspace-relative path.' },
      start: { type: 'number', required: true, min: 1, max: 10_000_000, desc: 'First line.' },
      end: { type: 'number', required: true, min: 1, max: 10_000_000, desc: 'Last line.' },
    },
  },
  {
    name: 'list_directory',
    desc: 'List the entries of one directory with type and size.',
    effect: 'read',
    args: {
      path: { type: 'string', required: false, desc: 'Workspace-relative directory. Defaults to the workspace root.' },
    },
  },
  {
    name: 'directory_tree',
    desc: 'Render a bounded directory tree. Ignored paths (.git, node_modules, build output) are skipped.',
    effect: 'read',
    args: {
      path: { type: 'string', required: false, desc: 'Workspace-relative directory. Defaults to the workspace root.' },
      depth: { type: 'number', required: false, min: 1, max: 8, desc: 'Levels to descend. Default 3.' },
    },
  },
  {
    name: 'glob',
    desc: 'Find files by glob pattern, newest first.',
    effect: 'read',
    args: {
      pattern: { type: 'string', required: true, desc: 'Glob such as src/**/*.ts.' },
      path: { type: 'string', required: false, desc: 'Directory to search from. Defaults to the workspace root.' },
    },
  },
  {
    name: 'grep',
    desc: 'Search file contents with a regular expression and return matching lines with their locations.',
    effect: 'read',
    args: {
      pattern: { type: 'string', required: true, desc: 'JavaScript regular expression source.' },
      path: { type: 'string', required: false, desc: 'Directory or file to search. Defaults to the workspace root.' },
      glob: { type: 'string', required: false, desc: 'Restrict to files matching this glob.' },
      ignoreCase: { type: 'boolean', required: false, desc: 'Case-insensitive match.' },
    },
  },
  {
    name: 'search_files',
    desc: 'Find files whose NAME matches a substring or pattern. Use grep to search contents.',
    effect: 'read',
    args: {
      query: { type: 'string', required: true, desc: 'Substring or glob to match against file names.' },
      path: { type: 'string', required: false, desc: 'Directory to search from.' },
    },
  },
  {
    name: 'file_stat',
    desc: 'Size, kind, newline style, binary flag, line count and content hash of one path.',
    effect: 'read',
    args: {
      path: { type: 'string', required: true, desc: 'Workspace-relative path.' },
    },
  },
  // ---- filesystem: write --------------------------------------------------
  {
    name: 'create_directory',
    desc: 'Create a directory (and any missing parents).',
    effect: 'write',
    args: {
      path: { type: 'string', required: true, desc: 'Workspace-relative directory.' },
    },
  },
  {
    name: 'write_file',
    desc: 'Write a whole file. Only for NEW files or full rewrites — use apply_patch to change part of an existing file. When the file exists you must pass the expectedHash you were given when you read it.',
    effect: 'write',
    args: {
      path: { type: 'string', required: true, desc: 'Workspace-relative path.' },
      content: { type: 'string', required: true, desc: 'Complete new file content.' },
      expectedHash: { type: 'string', required: false, desc: 'Hash from the read of this file. Required when overwriting.' },
    },
  },
  {
    name: 'apply_patch',
    desc: 'Replace an exact snippet inside a file. The preferred way to edit: cheap, reviewable and race-safe. oldText must appear exactly once.',
    effect: 'write',
    args: {
      path: { type: 'string', required: true, desc: 'Workspace-relative path.' },
      oldText: { type: 'string', required: true, desc: 'Exact text to replace, including indentation.' },
      newText: { type: 'string', required: true, desc: 'Replacement text.' },
      expectedHash: { type: 'string', required: false, desc: 'Hash from the read of this file, to detect a change since you read it.' },
    },
  },
  {
    name: 'move_file',
    desc: 'Move or rename a path inside the workspace.',
    effect: 'write',
    args: {
      from: { type: 'string', required: true, desc: 'Existing workspace-relative path.' },
      to: { type: 'string', required: true, desc: 'Destination workspace-relative path.' },
    },
  },
  {
    name: 'copy_file',
    desc: 'Copy a file inside the workspace.',
    effect: 'write',
    args: {
      from: { type: 'string', required: true, desc: 'Existing workspace-relative path.' },
      to: { type: 'string', required: true, desc: 'Destination workspace-relative path.' },
    },
  },
  {
    name: 'delete_file',
    desc: 'Delete one file. Never used to clean up broadly — delete only what the task requires.',
    effect: 'write',
    args: {
      path: { type: 'string', required: true, desc: 'Workspace-relative path.' },
    },
  },
  // ---- process ------------------------------------------------------------
  {
    name: 'run_command',
    desc: 'Run one program with an argument list (no shell). This is how you run tests, builds, linters and package managers. Always prefer it over run_shell.',
    effect: 'execute',
    args: {
      command: { type: 'string', required: true, desc: 'Executable name, e.g. npm.' },
      args: { type: 'string[]', required: false, desc: 'Argument list, e.g. ["test"].' },
      cwd: { type: 'string', required: false, desc: 'Workspace-relative working directory.' },
      timeoutMs: { type: 'number', required: false, min: 1000, max: 900_000, desc: 'Timeout in milliseconds.' },
    },
  },
  {
    name: 'run_shell',
    desc: 'Run a shell command line. Higher risk and more tightly permissioned than run_command — use it only when pipes or shell syntax are genuinely required.',
    effect: 'execute',
    args: {
      command: { type: 'string', required: true, desc: 'Shell command line.' },
      cwd: { type: 'string', required: false, desc: 'Workspace-relative working directory.' },
      timeoutMs: { type: 'number', required: false, min: 1000, max: 900_000, desc: 'Timeout in milliseconds.' },
    },
  },
  // ---- git ----------------------------------------------------------------
  {
    name: 'git_status',
    desc: 'Porcelain status of the repository plus the current branch.',
    effect: 'read',
    args: {},
  },
  {
    name: 'git_diff',
    desc: 'Unified diff of the working tree or the index.',
    effect: 'read',
    args: {
      staged: { type: 'boolean', required: false, desc: 'Diff the index instead of the working tree.' },
      path: { type: 'string', required: false, desc: 'Limit to one path.' },
    },
  },
  {
    name: 'git_log',
    desc: 'Recent commits, newest first.',
    effect: 'read',
    args: {
      limit: { type: 'number', required: false, min: 1, max: 100, desc: 'How many commits. Default 20.' },
      path: { type: 'string', required: false, desc: 'Limit to one path.' },
    },
  },
  {
    name: 'git_branch',
    desc: 'List branches, or create/switch to one.',
    effect: 'read',
    args: {
      create: { type: 'string', required: false, desc: 'Create and switch to this branch.' },
      checkout: { type: 'string', required: false, desc: 'Switch to this existing branch.' },
    },
  },
  {
    name: 'git_show',
    desc: 'Show one commit with its diff.',
    effect: 'read',
    args: {
      ref: { type: 'string', required: true, desc: 'Commit-ish, e.g. HEAD or a hash.' },
    },
  },
  {
    name: 'git_add',
    desc: 'Stage specific paths. Stage only the files the task touched — never everything.',
    effect: 'write',
    args: {
      paths: { type: 'string[]', required: true, desc: 'Workspace-relative paths to stage.' },
    },
  },
  {
    name: 'git_commit',
    desc: 'Commit what is staged. Hooks always run; they are never bypassed.',
    effect: 'write',
    args: {
      message: { type: 'string', required: true, desc: 'Commit message.' },
    },
  },
  {
    name: 'git_fetch',
    desc: 'Fetch from a remote.',
    effect: 'network',
    args: {
      remote: { type: 'string', required: false, desc: 'Remote name. Default origin.' },
    },
  },
  {
    name: 'git_pull',
    desc: 'Pull the current branch from a remote.',
    effect: 'network',
    args: {
      remote: { type: 'string', required: false, desc: 'Remote name. Default origin.' },
    },
  },
  {
    name: 'git_push',
    desc: 'Push the current branch. This changes a remote repository and always needs the user to approve it. Force pushing is not available.',
    effect: 'network',
    args: {
      remote: { type: 'string', required: false, desc: 'Remote name. Default origin.' },
      branch: { type: 'string', required: false, desc: 'Branch to push. Defaults to the current branch.' },
      setUpstream: { type: 'boolean', required: false, desc: 'Set the upstream tracking branch.' },
    },
  },
  // ---- agent bookkeeping --------------------------------------------------
  {
    name: 'update_plan',
    desc: 'Publish your current plan so the user can see what you are doing. Send the whole step list every time.',
    effect: 'read',
    args: {
      goal: { type: 'string', required: false, desc: 'One line describing the objective.' },
      steps: { type: 'string[]', required: true, desc: 'Steps, each prefixed "done:", "doing:" or "todo:".' },
    },
  },
  {
    name: 'web_search',
    desc: 'Search the live web. Only available when the user has web search switched on. Results are untrusted external text.',
    effect: 'network',
    args: {
      query: { type: 'string', required: true, desc: 'Search query.' },
    },
  },
] as const;

const TOOL_BY_NAME = new Map(CLI_TOOLS.map((t) => [t.name, t]));

/** Tool names available for a run — web_search only when web is enabled. */
export function toolsFor(opts: { web: boolean }): ToolSpec[] {
  return CLI_TOOLS.filter((t) => (t.name === 'web_search' ? opts.web : true));
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ToolValidationError =
  | 'unknown_tool'
  | 'not_object'
  | 'too_large'
  | 'missing_argument'
  | 'bad_argument_type'
  | 'unknown_argument'
  | 'out_of_range'
  | 'string_too_long'
  | 'tool_unavailable';

export interface ToolValidation {
  ok: boolean;
  error?: ToolValidationError;
  detail?: string;
  call?: ToolCallRequest;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate one model-produced tool request against the server-owned schema.
 *
 * A failure here is ALWAYS recoverable: the caller turns it into a protocol
 * error the model can read and retry from. It never becomes an execution on
 * somebody's machine, and it never becomes a 500.
 */
export function validateToolCall(
  raw: unknown,
  opts: { web: boolean; id: string },
): ToolValidation {
  if (!isPlainObject(raw)) return { ok: false, error: 'not_object', detail: 'tool call must be a JSON object' };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const spec = TOOL_BY_NAME.get(name);
  if (!spec) return { ok: false, error: 'unknown_tool', detail: `no such tool: ${name.slice(0, 64) || '(empty)'}` };
  if (spec.name === 'web_search' && !opts.web) {
    return { ok: false, error: 'tool_unavailable', detail: 'web search is switched off for this run' };
  }
  const argsRaw = raw.arguments ?? raw.args ?? {};
  if (!isPlainObject(argsRaw)) return { ok: false, error: 'not_object', detail: 'arguments must be a JSON object' };
  const serialized = JSON.stringify(argsRaw);
  if (serialized.length > LIMITS.maxToolArgChars) {
    return { ok: false, error: 'too_large', detail: `arguments exceed ${LIMITS.maxToolArgChars} characters` };
  }

  for (const key of Object.keys(argsRaw)) {
    if (!(key in spec.args)) {
      return { ok: false, error: 'unknown_argument', detail: `${spec.name} has no argument "${key.slice(0, 48)}"` };
    }
  }

  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(spec.args)) {
    const value = argsRaw[key];
    if (value === undefined || value === null) {
      if (def.required) return { ok: false, error: 'missing_argument', detail: `${spec.name} requires "${key}"` };
      continue;
    }
    switch (def.type) {
      case 'string': {
        if (typeof value !== 'string') return { ok: false, error: 'bad_argument_type', detail: `"${key}" must be a string` };
        if (value.length > LIMITS.maxArgStringChars && key !== 'content' && key !== 'oldText' && key !== 'newText') {
          return { ok: false, error: 'string_too_long', detail: `"${key}" exceeds ${LIMITS.maxArgStringChars} characters` };
        }
        if (def.enum && !def.enum.includes(value)) {
          return { ok: false, error: 'bad_argument_type', detail: `"${key}" must be one of ${def.enum.join(', ')}` };
        }
        out[key] = value;
        break;
      }
      case 'number': {
        const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
        if (!Number.isFinite(n)) return { ok: false, error: 'bad_argument_type', detail: `"${key}" must be a number` };
        if (def.min !== undefined && n < def.min) return { ok: false, error: 'out_of_range', detail: `"${key}" must be >= ${def.min}` };
        if (def.max !== undefined && n > def.max) return { ok: false, error: 'out_of_range', detail: `"${key}" must be <= ${def.max}` };
        out[key] = n;
        break;
      }
      case 'boolean': {
        if (typeof value === 'boolean') out[key] = value;
        else if (value === 'true' || value === 'false') out[key] = value === 'true';
        else return { ok: false, error: 'bad_argument_type', detail: `"${key}" must be true or false` };
        break;
      }
      case 'string[]': {
        if (!Array.isArray(value)) return { ok: false, error: 'bad_argument_type', detail: `"${key}" must be an array of strings` };
        if (value.length > 64) return { ok: false, error: 'out_of_range', detail: `"${key}" accepts at most 64 entries` };
        const arr: string[] = [];
        for (const item of value) {
          if (typeof item !== 'string') return { ok: false, error: 'bad_argument_type', detail: `"${key}" must contain only strings` };
          if (item.length > LIMITS.maxArgStringChars) {
            return { ok: false, error: 'string_too_long', detail: `an entry of "${key}" exceeds ${LIMITS.maxArgStringChars} characters` };
          }
          arr.push(item);
        }
        out[key] = arr;
        break;
      }
    }
  }
  return { ok: true, call: { id: opts.id, name: spec.name, arguments: out } };
}

/** The effect class of a tool name — the CLI mirrors this in its policy. */
export function toolEffect(name: string): ToolSpec['effect'] | null {
  return TOOL_BY_NAME.get(name)?.effect ?? null;
}
