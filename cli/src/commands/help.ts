/**
 * `vinax --help`.
 *
 * One screen, VinaX terminology only, and every flag that exists. A help
 * output that omits options is worse than none, because it teaches people the
 * tool cannot do something it can.
 */
import { CLI_VERSION } from '../version.js';
import { EXIT_LABEL } from '../utils/exit.js';

export function helpText(): string {
  return `VinaX CLI ${CLI_VERSION} — the VinaX coding agent, in your terminal.

USAGE
  vinax                             Start an interactive session in this directory
  vinax "<request>"                 Run one request and print the answer
  vinax -p "<request>"              The same, explicitly non-interactive
  vinax exec "<request>"            The same, for scripts
  vinax --json -p "<request>"       Emit JSONL events instead of prose
  vinax models                      List engines and the live model menus
  vinax sessions                    List saved sessions
  vinax doctor                      Check that this machine is set up
  vinax mcp list|add|remove         Manage external tool servers

WHAT IT DOES
  VinaX works on the project in front of it: it reads and searches files,
  edits them, runs your tests and builds, reads the real output, iterates when
  something fails, and — when you approve it — stages, commits and pushes.

OPTIONS
  --cwd <dir>            Work in this directory instead of the current one
  --add-dir <dir>        Approve an extra directory (repeatable)
  --engine <id>          Choose a VinaX engine (see: vinax models)
  --model <id>           Choose a model, on engines that take one
  --web / --no-web       Turn live web search on or off (default off)
  --approval <mode>      ask | auto-edit | full-auto (default ask)
  --ask                  Same as --approval ask
  --auto-edit            Same as --approval auto-edit
  --full-auto            Same as --approval full-auto
  --max-steps <n>        Cap the model steps in one run
  -c, --continue         Continue the most recent session in this directory
  --resume <id>          Resume a specific session
  -p, --print <text>     Non-interactive: run this request and exit
  --json                 Machine-readable JSONL events on stdout
  --debug                Verbose diagnostics (secrets are still redacted)
  --color / --no-color   Force colour on or off
  -h, --help             This help
  -v, --version          Print the version

APPROVAL MODES
  ask         Reads happen freely. Edits, commands, commits, pushes and
              anything outside the workspace are confirmed first. (default)
  auto-edit   Project reads, edits and routine commands run unattended.
              Remote writes, installs, destructive commands, credential files
              and anything outside the workspace still ask.
  full-auto   Routine project work runs unattended. Privilege escalation,
              destructive system commands, credential stores, remote
              repository writes and anything outside the workspace still ask —
              in every mode, including this one.

ENVIRONMENT
  VINAX_API_BASE   Point the CLI at a different VinaX service (development)
  VINAX_HOME       Configuration directory (default ~/.vinax)
  VINAX_ENGINE     Default engine
  NO_COLOR         Disable colour

  VinaX CLI needs no AI provider keys. It talks to the VinaX service, and the
  VinaX service talks to the engines.

EXIT CODES
${Object.entries(EXIT_LABEL).map(([code, label]) => `  ${code.padEnd(4)} ${label}`).join('\n')}

DOCUMENTATION
  https://www.sirimillavinay.online/VinaXAI/cli/docs
`;
}
