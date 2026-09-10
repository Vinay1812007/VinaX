/**
 * The content of the public VinaX CLI documentation.
 *
 * Kept as data rather than JSX so the page can build its table of contents,
 * its mobile navigation and its scroll-spy from one source — a hand-written
 * sidebar and a hand-written page drift apart within one release, and then
 * the contents list quietly lies about what the page contains.
 *
 * Nothing here hard-codes anything that drifts: engine names and counts come
 * from the live service at runtime (see CliDocsPage), never from this file.
 */

export interface DocBlock {
  kind: 'p' | 'code' | 'list' | 'table' | 'note';
  /** Prose, a code sample, or list items. */
  text?: string;
  items?: string[];
  /** Language label shown above a code block. */
  lang?: string;
  /** Header row then body rows. */
  rows?: string[][];
}

export interface DocSection {
  id: string;
  title: string;
  /** Grouping for the sidebar. */
  group: string;
  blocks: DocBlock[];
}

const p = (text: string): DocBlock => ({ kind: 'p', text });
const code = (text: string, lang = 'bash'): DocBlock => ({ kind: 'code', text, lang });
const list = (items: string[]): DocBlock => ({ kind: 'list', items });
const note = (text: string): DocBlock => ({ kind: 'note', text });
const table = (rows: string[][]): DocBlock => ({ kind: 'table', rows });

export const DOC_SECTIONS: DocSection[] = [
  {
    id: 'overview',
    title: 'VinaX CLI',
    group: 'Getting started',
    blocks: [
      p('VinaX CLI puts the VinaX coding agent in your terminal. It works on the project in front of it: it reads and searches your files, edits them, runs your tests and builds, reads the real output, keeps going when something fails, and — when you approve it — stages, commits and pushes.'),
      p('It is not a chat window that suggests commands for you to type. It runs them, on your machine, inside a permission system you control.'),
      p('You do not need an AI provider key. VinaX CLI talks to the VinaX service; the VinaX service talks to the engines.'),
    ],
  },
  {
    id: 'installation',
    title: 'Installation',
    group: 'Getting started',
    blocks: [
      note('VinaX CLI is not on the npm registry yet, so `npm install -g vinax-cli` does not work and will fail with E404. Install from source using the steps below — that method works today and will keep working after the npm release.'),
      p('Install from source. This clones the repository, builds the CLI and puts the vinax command on your PATH:'),
      code('git clone https://github.com/Vinay1812007/VinaX.git\ncd VinaX/cli\nnpm ci\nnpm run build\nnpm install -g .'),
      p('Check it worked:'),
      code('vinax --version\nvinax doctor'),
      p('`vinax doctor` confirms your Node version, that it can reach the VinaX service, that the protocol matches, which engines are available, and whether Git is present. It prints no secrets.'),
      p('Once VinaX CLI is published to npm, installing will be a single command and this page will say so:'),
      code('npm install -g vinax-cli'),
      p('To update a source install, pull and rebuild:'),
      code('cd VinaX && git pull\ncd cli && npm ci && npm run build && npm install -g .'),
    ],
  },
  {
    id: 'requirements',
    title: 'Requirements',
    group: 'Getting started',
    blocks: [
      list([
        'Node.js 22 or newer.',
        'Git, if you want VinaX to read diffs, commit or push. Everything else works without it.',
        'A terminal, for interactive sessions. Non-interactive runs work anywhere, including CI.',
        'No AI provider keys, ever.',
      ]),
    ],
  },
  {
    id: 'quick-start',
    title: 'Quick start',
    group: 'Getting started',
    blocks: [
      p('Open a session in your project:'),
      code('cd my-project\nvinax'),
      p('Then type what you want done, in your own words:'),
      code('Find why the tests fail and fix them.', 'text'),
      p('Or run one request and exit — useful in a script:'),
      code('vinax -p "explain what this repository does"\nvinax exec "run the tests and report failures"\nvinax --json -p "list the files that changed since main"'),
    ],
  },
  {
    id: 'interactive-mode',
    title: 'Interactive mode',
    group: 'Using VinaX CLI',
    blocks: [
      p('Running vinax with no arguments starts a session in the current directory. The header tells you where you are, which branch you are on, which engine is answering, how much VinaX may do without asking, and whether web search is on.'),
      code(`VinaX CLI

Project    /home/vinay/project
Branch     feature/login
Engine     auto
Access     ask
Web        Off

• /help for commands, Ctrl+C to interrupt, /exit to leave`, 'text'),
      p('As VinaX works, each action appears on its own line as it happens — what it read, what it ran, what it changed. A step in progress animates on a single line and is replaced by its result, so the transcript keeps the outcome and not a trail of dead spinner frames:'),
      code(`Running npm test...

Ran npm test · 4.7s`, 'text'),
      p('Your terminal behaves normally throughout. VinaX draws inline rather than taking over the screen, so you can scroll back, select and copy everything exactly as usual.'),
      p('Ctrl+C during a turn stops that turn: the model request is cancelled and any command VinaX started is stopped, along with everything that command started. You are returned to the prompt with the session intact. Ctrl+C at the prompt clears what you have typed; again on an empty line exits.'),
    ],
  },
  {
    id: 'keyboard',
    title: 'Keyboard controls',
    group: 'Using VinaX CLI',
    blocks: [
      p('VinaX CLI is a keyboard application. Arrow keys move, Enter chooses, Esc backs out.'),
      table([
        ['Key', 'What it does'],
        ['Up / Down', 'Move through a menu; with no menu open, your prompt history'],
        ['Left / Right', 'Move the cursor within what you are typing'],
        ['Enter', 'Send your message, or choose the highlighted item'],
        ['Tab', 'Complete the highlighted command'],
        ['Esc', 'Close a menu; on an approval, reject'],
        ['Home / End', 'Start or end of the line'],
        ['Ctrl+A / Ctrl+E', 'Start or end of the line'],
        ['Ctrl+U / Ctrl+K', 'Delete before / after the cursor'],
        ['Ctrl+W', 'Delete the previous word'],
        ['Alt+Left / Alt+Right', 'Move a word at a time'],
        ['Ctrl+J', 'Insert a newline without sending'],
        ['Ctrl+C', 'Interrupt the current turn; at an empty prompt, exit'],
        ['Ctrl+D', 'Exit, when the prompt is empty'],
      ]),
      p('Pasting several lines pastes them — it does not send one message per line.'),
    ],
  },
  {
    id: 'menus',
    title: 'Menus and selectors',
    group: 'Using VinaX CLI',
    blocks: [
      p('Type / and the command menu opens immediately, narrowing as you keep typing. No key is needed to discover what is available:'),
      code(`> /per

  > /permissions   Change approval mode

  Up/Down select · Enter choose · Tab complete · Esc close`, 'text'),
      p('These commands open a selector when you give them no argument:'),
      table([
        ['Command', 'Opens'],
        ['/engine', 'The engines available right now, fetched live'],
        ['/model', 'The live model catalogue, on engines that take one'],
        ['/permissions', 'Ask, Auto edit or Full auto, with what each allows'],
        ['/resume', 'Your saved sessions, newest first'],
      ]),
      p('The direct forms still work, for habit and for scripts: /engine fast, /permissions auto-edit, /resume <id>.'),
    ],
  },
  {
    id: 'agent-mode',
    title: 'How the agent works',
    group: 'Using VinaX CLI',
    blocks: [
      p('Every turn is a loop:'),
      list([
        'You describe the task.',
        'The VinaX service asks for a tool — read this file, run this command, patch this line.',
        'VinaX CLI checks that request against your permission settings, and asks you when it should.',
        'The tool runs on your machine, and the real result goes back.',
        'The service decides what to do next, and the loop continues.',
      ]),
      p('The model cannot run anything itself. The service cannot touch your machine. Only the CLI on your computer can, and only after the permission system has agreed. The loop ends when the task is done, you interrupt, a permission is refused, or the step limit is reached — and VinaX says which.'),
    ],
  },
  {
    id: 'local-access',
    title: 'Local device access',
    group: 'Using VinaX CLI',
    blocks: [
      p('VinaX works inside a workspace. By default that is your Git repository root, or the current directory when there is no repository.'),
      p('To let it work in another directory as well:'),
      code('vinax --add-dir ../shared-library'),
      p('Anything outside an approved directory is refused by default, and confirmed with you when it is genuinely needed. VinaX uses the permissions the operating system already gave the process; it never tries to get around them.'),
    ],
  },
  {
    id: 'workspace-security',
    title: 'Workspace security',
    group: 'Security',
    blocks: [
      p('Every file operation resolves its path completely — following every symbolic link — and then checks that where it really points is inside a directory you approved. A path that leaves the workspace is refused, whether it does so with ../, through a link, through a link to a link, or through a device path.'),
      p('The check compares whole path segments, never string prefixes: a sibling directory whose name merely starts the same way is outside the workspace and is treated that way.'),
    ],
  },
  {
    id: 'permission-modes',
    title: 'Permission modes',
    group: 'Security',
    blocks: [
      p('Three modes control how much VinaX may do without stopping to ask.'),
      table([
        ['Mode', 'Runs without asking', 'Always asks'],
        ['ask (default)', 'Ordinary reads inside the workspace', 'Edits, deletes, commands, package installs, staging, commits, pushes, credential files, anything outside the workspace'],
        ['auto-edit', 'Reads, edits, deletes and routine project commands', 'Remote writes, installs, destructive commands, credential files, anything outside the workspace'],
        ['full-auto', 'Routine project work, including installs and builds', 'Privilege escalation, destructive system commands, credential stores, remote repository writes, anything outside the workspace'],
      ]),
      code('vinax --approval ask\nvinax --approval auto-edit\nvinax --approval full-auto'),
      note('full-auto is not unrestricted control of your computer. Some actions are confirmed in every mode, including this one: sudo and other privilege escalation, formatting disks, shutting the machine down, deleting operating-system directories, reading credential stores or SSH keys, force pushing, and anything outside the workspace.'),
      p('You can change mode mid-session with /permissions, and tighten it at any time.'),
    ],
  },
  {
    id: 'permission-prompts',
    title: 'What an approval looks like',
    group: 'Security',
    blocks: [
      p('A prompt shows the exact action, never a summary of one.'),
      code(`◆ Run command?

  npm test

  Working directory:
  /home/user/project

  > Allow once
    Allow npm commands this session
    Reject

  Up/Down navigate · Enter confirm · y allow · n reject · Esc reject`, 'text'),
      p('For an edit, you see the real diff before you agree to it:'),
      code(`◆ Modify src/api/client.ts?

  @@ -12,1 +12,1 @@
  -const timeout = 1000;
  +const timeout = 5000;

  > Allow once
    Allow project edits this session
    Reject`, 'text'),
      p('For a push, you see exactly what is about to leave your machine:'),
      code(`◆ Push changes?

  Remote:  origin
  Branch:  feature/login-fix
  Commits: 2

  This changes the remote repository.

  > Allow once
    Allow normal pushes this session
    Reject`, 'text'),
      p('Choose with the arrow keys and Enter, or press y to allow once and n to reject. Esc and Ctrl+C both reject — the safe answer is the one you get by not deciding. A high-impact action is never offered a blanket session grant.'),
    ],
  },
  {
    id: 'reading-files',
    title: 'Reading files',
    group: 'What it can do',
    blocks: [
      p('VinaX reads whole files, line ranges, directory listings and bounded trees, and searches by name, by glob and by content. Reads inside your workspace happen without interrupting you.'),
      list([
        'Binary files are refused rather than turned into noise.',
        'Large files are refused with a pointer to reading a range instead.',
        'Truncation is always reported, never silent.',
        'Every read returns a content hash, which VinaX must quote back when it edits that file.',
        '.gitignore is respected, along with a built-in list of generated and vendored directories.',
      ]),
    ],
  },
  {
    id: 'editing-files',
    title: 'Editing files',
    group: 'What it can do',
    blocks: [
      p('Edits are surgical by default: VinaX replaces the exact snippet it means to change rather than rewriting the file. Rewriting a whole file to change three lines is treated as a mistake, not a shortcut.'),
      list([
        'Writes are atomic — a crash mid-write leaves your original file intact, never half of one.',
        'File permissions and line-ending style survive the edit.',
        'If the file changed since VinaX read it, the write is refused and VinaX re-reads instead of overwriting your work.',
        'Every change is journalled, so /undo can put it back.',
      ]),
    ],
  },
  {
    id: 'running-commands',
    title: 'Running commands',
    group: 'What it can do',
    blocks: [
      p('VinaX runs programs directly with an argument list — no shell — so a filename with a space or a semicolon is data, not syntax. A shell line is available when pipes or shell syntax are genuinely needed, and it asks more carefully.'),
      list([
        'Output streams live as the command runs.',
        'The exit code is preserved and reported.',
        'A command that runs too long is stopped, along with everything it started.',
        'Ctrl+C stops the command and its whole process tree, then hands you back the prompt.',
        'Nothing VinaX started survives the session ending.',
      ]),
    ],
  },
  {
    id: 'running-tests',
    title: 'Running tests and builds',
    group: 'What it can do',
    blocks: [
      p('Running the tests is how VinaX finds out whether a change worked, so it does it rather than asking you to. It reads the real output, works out what failed, changes the code, and runs them again.'),
      code('npm test\nnpm run build\npnpm test\npython -m pytest\ncargo test\ngo test ./...', 'text'),
      p('Long-running processes like a dev server are recognised as such: output streams, and Ctrl+C stops them cleanly.'),
    ],
  },
  {
    id: 'git',
    title: 'Git',
    group: 'Git',
    blocks: [
      p('Git is a first-class part of VinaX CLI, not a shell string. Status, diff, log, branches, show, staging, commits, fetch, pull and push are all typed operations that run your own git binary with your own credential helper and SSH configuration.'),
      note('VinaX never asks for a Git password and never stores one. It also has no way to reset --hard, clean, checkout over your changes, force push, delete a remote branch or rewrite history — those operations do not exist in the tool set.'),
    ],
  },
  {
    id: 'commits',
    title: 'Commits',
    group: 'Git',
    blocks: [
      p('Ask VinaX to commit and it will inspect the status and the diff, make sure the validation you asked for actually ran, propose a message, show you the staged diff, and commit only what this task touched.'),
      code('commit these changes', 'text'),
      list([
        'Staging is by explicit path. Your unrelated work in progress is never swept in.',
        'Your commit hooks always run. VinaX never adds --no-verify.',
        'The commit hash it reports is the one Git returned. If the commit failed, it says so and why.',
      ]),
    ],
  },
  {
    id: 'pushes',
    title: 'Pushes',
    group: 'Git',
    blocks: [
      p('Ask VinaX to push and it shows you the remote, the branch, the tracking branch and the commits involved before anything leaves your machine.'),
      code('push this branch', 'text'),
      p('Remote writes need your approval every time, in every mode, unless you grant them for the session. A rejected push is reported as rejected — VinaX will not force it through.'),
    ],
  },
  {
    id: 'remote-actions',
    title: 'Pull requests and CI',
    group: 'Git',
    blocks: [
      p('If your repository host\'s command-line tool is installed and already authenticated, VinaX can use it to inspect issues and pull requests, open a pull request, check CI status, read CI logs and comment — through the same permission system, because these change things outside your machine.'),
      p('VinaX never installs that tool and never authenticates it for you. If it is missing or not signed in, VinaX says so rather than pretending.'),
    ],
  },
  {
    id: 'engines',
    title: 'Engines',
    group: 'Engines and models',
    blocks: [
      p('VinaX routes your request to one of its engines. The default, auto, picks a seat from the task itself — a quick lookup and a hard concurrency bug do not want the same engine.'),
      code('vinax --engine auto\nvinax models'),
      p('The list below is fetched live from the VinaX service, so it is always what is actually available right now.'),
    ],
  },
  {
    id: 'models',
    title: 'Models',
    group: 'Engines and models',
    blocks: [
      p('Some engines are backed by a live catalogue of free models rather than one fixed model. On those, you can name the exact model:'),
      code('vinax --engine menu --model <model-id>'),
      p('The model is validated by the service against the live catalogue. If a model disappears between choosing it and using it, you get a clear error and can pick again — VinaX never quietly substitutes a paid model.'),
      p('In a session, /models shows the live menu and /model chooses one.'),
    ],
  },
  {
    id: 'web-search',
    title: 'Web search',
    group: 'Engines and models',
    blocks: [
      p('Live web search is off by default. Turn it on for a run, or for the rest of a session:'),
      code('vinax --web'),
      code('/web on\n/web off', 'text'),
      p('When it is on, the header says so and each search appears in the transcript. Web results are external text from arbitrary pages: VinaX treats them as data, never as instructions, and they gain no permissions.'),
    ],
  },
  {
    id: 'project-instructions',
    title: 'Project instructions',
    group: 'Configuration',
    blocks: [
      p('A file at the root of your project tells VinaX how this project works — build commands, conventions, what to run before committing. VinaX reads it at the start of every session.'),
      code('VINAX.md\n.vinax/instructions.md', 'text'),
      p('An existing AGENTS.md is recognised too. In a monorepo, a package\'s own file layers on top of the root one, and the more specific file wins.'),
      p('Write a starter file for the current project:'),
      code('/init', 'text'),
      note('Project instructions describe conventions. They cannot relax VinaX\'s security rules, widen its access, or change what it will ask you about — and neither can anything else inside a repository. Files, comments, READMEs, test fixtures, logs and web pages are all data. If one of them contains text shaped like an instruction, VinaX mentions it to you rather than obeying it.'),
    ],
  },
  {
    id: 'configuration',
    title: 'Configuration',
    group: 'Configuration',
    blocks: [
      p('Your own settings live in your VinaX directory, and a project may carry its own:'),
      code('~/.vinax/config.json      your settings\n.vinax/config.json        the project\'s settings', 'text'),
      code(`{
  "engine": "auto",
  "approval": "ask",
  "web": false,
  "maxSteps": 60
}`, 'json'),
      p('Settings are resolved in this order, most important first: command-line flags, environment variables, your own config, the project\'s config, then defaults.'),
      note('A project\'s config can make VinaX stricter — a tighter approval mode, web off, a lower step limit — and it is honoured. It can never make VinaX more permissive. A repository asking for full-auto is ignored and you are told it was ignored, because cloning code should not hand that code more access to your machine.'),
    ],
  },
  {
    id: 'environment',
    title: 'Environment variables',
    group: 'Configuration',
    blocks: [
      table([
        ['Variable', 'What it does'],
        ['VINAX_API_BASE', 'Point the CLI at a different VinaX service. For local development against a dev worker.'],
        ['VINAX_HOME', 'Where VinaX keeps config, sessions and cache. Defaults to ~/.vinax.'],
        ['VINAX_ENGINE', 'Default engine.'],
        ['VINAX_DEBUG', 'Set to 1 for verbose diagnostics.'],
        ['NO_COLOR', 'Disable colour output.'],
      ]),
      note('There is no variable for an AI provider key, because VinaX CLI never uses one. Provider credentials live only on the VinaX service.'),
    ],
  },
  {
    id: 'sessions',
    title: 'Sessions',
    group: 'Sessions',
    blocks: [
      p('Every session is saved on your own machine — the messages, the tool calls, the files changed, the commands run and what they said. Nothing about a coding session is stored on a server.'),
      code('vinax sessions\nvinax --continue\nvinax --resume <session-id>'),
      code('/sessions\n/resume <id>\n/clear', 'text'),
      p('Sessions are written as they happen, so a session interrupted by Ctrl+C, a closed laptop or a crash is still there and still resumable.'),
    ],
  },
  {
    id: 'context',
    title: 'Context management',
    group: 'Sessions',
    blocks: [
      p('A long task eventually outgrows the model\'s context. VinaX compacts it rather than forgetting: your objective, the constraints, the files changed, what was run and what it said, what is still failing, and the decisions you made are all preserved, while the bulk is dropped.'),
      code('/compact', 'text'),
      p('It happens automatically when needed, and it says when it has happened.'),
    ],
  },
  {
    id: 'undo',
    title: 'Undo',
    group: 'Sessions',
    blocks: [
      p('VinaX keeps a journal of every edit it made, with the file\'s content before and after.'),
      code('/undo', 'text'),
      p('Undo restores the previous content of the most recent edit — but only after checking the file still holds what VinaX left there. If you have edited it since, VinaX refuses and tells you why, rather than throwing your change away. It never uses a global Git reset.'),
    ],
  },
  {
    id: 'slash-commands',
    title: 'Slash commands',
    group: 'Reference',
    blocks: [
      table([
        ['Command', 'What it does'],
        ['/help', 'List the commands'],
        ['/models', 'Engines and the live model menus'],
        ['/model [id]', 'Choose a model — opens the live catalogue with no argument'],
        ['/engine [id]', 'Switch engine — opens a selector with no argument'],
        ['/web on|off', 'Turn live web search on or off'],
        ['/status', 'What VinaX is doing, and what it has done'],
        ['/diff', 'Show the working-tree diff'],
        ['/permissions [mode]', 'Change the approval mode — opens a selector with no argument'],
        ['/files', 'Files VinaX has changed this session'],
        ['/compact', 'Summarise the conversation to free context'],
        ['/undo', 'Undo the most recent VinaX edit'],
        ['/clear', 'Start a fresh conversation'],
        ['/sessions', 'List saved sessions'],
        ['/resume [id]', 'Resume a session — opens a selector with no argument'],
        ['/init', 'Write a starter VINAX.md'],
        ['/mcp', 'Show configured external tool servers'],
        ['/doctor', 'Check the local setup'],
        ['/version', 'Show the version'],
        ['/exit', 'Leave VinaX CLI'],
      ]),
    ],
  },
  {
    id: 'file-references',
    title: 'Referring to a file',
    group: 'Reference',
    blocks: [
      p('Point at a file with @ and VinaX reads it with your message:'),
      code('@src/index.ts explain what this does\n@src/auth/session.ts @tests/auth.test.ts why does this test fail?', 'text'),
      p('References resolve against your approved workspace, so @../../secret cannot reach past it. A credential file is named but not inlined — reading it goes through the normal approval.'),
    ],
  },
  {
    id: 'status',
    title: 'Seeing what VinaX is doing',
    group: 'Reference',
    blocks: [
      p('/status shows the factual state of the run — what has happened, not what VinaX is thinking.'),
      code(`Goal
Fix authentication tests

Progress
✓ Inspected project
✓ Reproduced test failure
✓ Fixed token expiry calculation
● Running full tests
○ Commit

Files changed
src/auth/session.ts

Validation
✗ npm test — 1 failed, 46 passed

Git
feature/auth-fix`, 'text'),
    ],
  },
  {
    id: 'mcp',
    title: 'External tools (MCP)',
    group: 'Reference',
    blocks: [
      p('VinaX CLI can use external tool servers that speak the Model Context Protocol over standard input and output.'),
      code('vinax mcp list\nvinax mcp add <name> <command> [args…]\nvinax mcp remove <name>'),
      p('Configuration lives in your VinaX directory. In a session, /mcp shows what is connected.'),
      note('An external tool is a third-party program running on your machine. Its calls go through exactly the same permission system as VinaX\'s own tools, it can never bypass workspace boundaries or credential rules, and the server it came from is always named in the prompt. A tool\'s own description is text written by whoever wrote that server: VinaX shows it to you and never treats it as an instruction.'),
    ],
  },
  {
    id: 'non-interactive',
    title: 'Non-interactive mode',
    group: 'Automation',
    blocks: [
      p('For scripts and pipelines:'),
      code('vinax -p "explain this package"\nvinax exec "run the tests and report failures"\nvinax --json -p "inspect this repository"'),
      p('When output is not a terminal there are no spinners, no control codes and no prompts. A run that would need your approval does not hang: it stops and reports exactly which permission was required.'),
    ],
  },
  {
    id: 'json-output',
    title: 'JSON output',
    group: 'Automation',
    blocks: [
      p('--json emits one JSON object per line on standard output, and nothing else. The schema is versioned by the v field.'),
      code(`{"v":"vinax-cli-json/1","type":"engine","engine":"balanced","label":"VinaX Balanced"}
{"v":"vinax-cli-json/1","type":"status","status":"thinking"}
{"v":"vinax-cli-json/1","type":"assistant_delta","text":"Reading the tests."}
{"v":"vinax-cli-json/1","type":"tool_call","id":"call_1","tool":"read_file","arguments":{"path":"src/index.ts"}}
{"v":"vinax-cli-json/1","type":"tool_result","id":"call_1","tool":"read_file","ok":true}
{"v":"vinax-cli-json/1","type":"permission_required","action":"git_push"}
{"v":"vinax-cli-json/1","type":"usage","inputTokens":1200,"outputTokens":180}
{"v":"vinax-cli-json/1","type":"final","text":"Fixed the token expiry calculation."}`, 'json'),
      p('Diagnostics go to standard error, so redirecting standard output gives you a clean event file.'),
    ],
  },
  {
    id: 'exit-codes',
    title: 'Exit codes',
    group: 'Automation',
    blocks: [
      p('Automation never has to read English to find out what happened.'),
      table([
        ['Code', 'Meaning'],
        ['0', 'Success — the agent finished and answered'],
        ['1', 'Failure with no more specific code'],
        ['2', 'Invalid usage — a bad flag or an unknown command'],
        ['3', 'VinaX API failure — offline, timeout, service error'],
        ['4', 'Permission denied — an approval was required and refused'],
        ['5', 'Maximum steps reached before the task finished'],
        ['6', 'A tool failed unrecoverably'],
        ['130', 'Interrupted'],
      ]),
    ],
  },
  {
    id: 'ci',
    title: 'Using VinaX in CI',
    group: 'Automation',
    blocks: [
      p('In CI there is nobody to approve anything, so decide up front what the run may do and read the exit code afterwards.'),
      code(`vinax --json --approval auto-edit -p "fix the lint errors" > events.jsonl
case $? in
  0) echo "done" ;;
  4) echo "needed an approval nobody could give" ;;
  5) echo "ran out of steps" ;;
  *) echo "failed" ;;
esac`),
      p('Colour is disabled automatically when CI is set or output is not a terminal.'),
    ],
  },
  {
    id: 'security',
    title: 'Security',
    group: 'Security and privacy',
    blocks: [
      list([
        'Workspace boundaries are enforced on the real, fully-resolved path, so no symlink or traversal escapes them.',
        'Credential files — .env, private keys, service accounts, SSH and cloud credential directories — are never read without your explicit approval, and you are told that their contents become model context.',
        'Everything a tool returns is scrubbed for secrets before it goes anywhere: private key blocks, authorization headers, tokens, passwords and credentials in URLs.',
        'Your environment is never sent to the model wholesale.',
        'Commands that would escalate privilege, destroy the machine or touch a credential store are confirmed in every mode, including full-auto.',
        'A repeated tool call is never executed twice — a dropped connection cannot become a second commit.',
        'Nothing in a repository can change VinaX\'s rules. The agent contract lives on the VinaX service and cannot be supplied or overridden by a client.',
      ]),
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy',
    group: 'Security and privacy',
    blocks: [
      p('What leaves your machine is what the task needs: your message, the project state VinaX gathered at startup, your project instruction file, and the contents of the files and command output the agent actually asked for.'),
      p('What does not leave your machine: the rest of your repository, your environment variables, your credentials, and your session history. Sessions are stored locally, in your own VinaX directory, and nowhere else.'),
      p('VinaX CLI holds no AI provider credentials, so there are none to leak from it.'),
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    group: 'Help',
    blocks: [
      table([
        ['What you see', 'What to do'],
        ['npm error 404 … vinax-cli', 'The package is not on the registry yet. Install from source — see Installation. This is expected, not a fault on your machine.'],
        ['Could not reach the VinaX service', 'Check your network. For local development, set VINAX_API_BASE.'],
        ['That engine is not configured', 'Run vinax models and pick another, or use --engine auto.'],
        ['That model is not in the live catalogue', 'Run /models for the current list — free catalogues change.'],
        ['This run cannot ask', 'A non-interactive run needed an approval. Choose an approval mode up front, or run interactively.'],
        ['The file changed since it was read', 'Something else edited it. VinaX re-reads and retries rather than overwriting.'],
        ['The push was rejected', 'The remote has commits you do not. Pull or rebase — VinaX will not force push.'],
        ['Git is not installed', 'Install Git for diff, commit and push. Everything else works without it.'],
        ['Stopped after N steps', 'The step limit was reached. Say "continue", or raise it with --max-steps.'],
      ]),
      p('For more detail on any failure:'),
      code('vinax --debug -p "…"'),
      p('Debug mode is verbose, and still redacts secrets.'),
    ],
  },
  {
    id: 'npm-404',
    title: 'npm says it cannot find vinax-cli',
    group: 'Help',
    blocks: [
      p('If you run the npm install command and see this:'),
      code(`npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/vinax-cli
npm error 404 The requested resource 'vinax-cli@*' could not be found`, 'text'),
      p('…then npm looked in the registry and found no such package. Today that is the expected answer: VinaX CLI has not been published to npm yet. Nothing is wrong with your machine, and there is nothing to fix locally.'),
      p('Install from source instead — see Installation. That is the supported method until the registry release.'),
      p('If you want to confirm the diagnosis for yourself:'),
      code('npm config get registry\nnpm view vinax-cli\nnode --version'),
      p('The registry should be https://registry.npmjs.org/ and Node should be 22 or newer. `npm view vinax-cli` returning E404 confirms the package is simply not published.'),
      note('Do not work around this with `sudo`, and do not disable npm\u2019s TLS or signature checking. Neither has anything to do with a package that does not exist, and both leave your machine worse off.'),
    ],
  },
  {
    id: 'doctor',
    title: 'vinax doctor',
    group: 'Help',
    blocks: [
      p('Checks everything VinaX needs, and says what to do about anything missing:'),
      code('vinax doctor'),
      list([
        'Node version and CLI version',
        'VinaX service reachability and protocol compatibility',
        'Git availability',
        'Workspace accessibility and repository state',
        'Configuration and session directories',
        'Terminal capabilities',
        'Repository host CLI, if one is installed',
        'Configured MCP servers',
      ]),
      p('It prints no secrets, and exits non-zero only when something would actually stop VinaX working.'),
    ],
  },
  {
    id: 'update',
    title: 'Updating and uninstalling',
    group: 'Help',
    blocks: [
      code('npm update -g vinax-cli\nnpm uninstall -g vinax-cli'),
      p('Uninstalling leaves your settings and sessions in place. To remove those too, delete your VinaX directory (~/.vinax, or wherever VINAX_HOME points).'),
    ],
  },
  {
    id: 'command-reference',
    title: 'Complete command reference',
    group: 'Reference',
    blocks: [
      table([
        ['Command', 'What it does'],
        ['vinax', 'Start an interactive session here'],
        ['vinax "<request>"', 'Run one request and print the answer'],
        ['vinax -p "<request>"', 'The same, explicitly non-interactive'],
        ['vinax exec "<request>"', 'The same, for scripts'],
        ['vinax --json -p "<request>"', 'Emit JSONL events'],
        ['vinax models', 'Engines and the live model menus'],
        ['vinax sessions', 'List saved sessions'],
        ['vinax doctor', 'Check the local setup'],
        ['vinax mcp list|add|remove', 'Manage external tool servers'],
        ['vinax --help', 'Full usage'],
        ['vinax --version', 'Version'],
      ]),
      table([
        ['Option', 'What it does'],
        ['--cwd <dir>', 'Work in this directory'],
        ['--add-dir <dir>', 'Approve an extra directory (repeatable)'],
        ['--engine <id>', 'Choose an engine'],
        ['--model <id>', 'Choose a model, on engines that take one'],
        ['--web / --no-web', 'Turn live web search on or off'],
        ['--approval <mode>', 'ask | auto-edit | full-auto'],
        ['--ask / --auto-edit / --full-auto', 'Shorthands for the above'],
        ['--max-steps <n>', 'Cap the model steps in one run'],
        ['-c, --continue', 'Continue the most recent session here'],
        ['--resume <id>', 'Resume a specific session'],
        ['-p, --print <text>', 'Non-interactive: run this and exit'],
        ['--json', 'Machine-readable JSONL events'],
        ['--debug', 'Verbose diagnostics'],
        ['--color / --no-color', 'Force colour on or off'],
      ]),
    ],
  },
];

/**
 * Sidebar groups, built from the sections themselves.
 *
 * Merged by NAME rather than by adjacency: a group whose sections are not all
 * next to each other in the document (Reference, for instance, which ends
 * with the full command table) must still appear once in the contents, not
 * twice under the same heading.
 */
export function docGroups(): Array<{ group: string; sections: DocSection[] }> {
  const byName = new Map<string, DocSection[]>();
  for (const section of DOC_SECTIONS) {
    const list = byName.get(section.group);
    if (list) list.push(section);
    else byName.set(section.group, [section]);
  }
  return [...byName.entries()].map(([group, sections]) => ({ group, sections }));
}
