# VinaX CLI — developer notes

The VinaX coding agent, as a terminal program. This file is for people
**working on** VinaX CLI. If you want to **use** it, the public documentation
is at <https://www.sirimillavinay.online/VinaXAI/cli/docs>.

---

## Contents

1. [What it is](#1-what-it-is)
2. [Architecture](#2-architecture)
3. [Directory structure](#3-directory-structure)
4. [Local development](#4-local-development)
5. [The protocol](#5-the-protocol)
6. [Security model](#6-security-model)
7. [Testing](#7-testing)
8. [Building and packaging](#8-building-and-packaging)
9. [Release process](#9-release-process)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. What it is

A Node 22 ESM package that publishes one binary, `vinax`. It is a **local
agent**: the model decides what it wants done, the VinaX Worker owns the agent
contract and every provider key, and this package is the only thing that can
actually touch the developer's machine.

Three properties are worth stating up front because most of the code exists to
maintain them:

- **No provider credentials, anywhere.** Not in the package, not in config,
  not in the environment, not in a session file. The CLI talks to VinaX; VinaX
  talks to the engines. A user of this tool never needs a key.
- **No runtime dependencies.** `dependencies` is empty and stays empty. A tool
  that can write to your disk and run your commands should not also drag a
  transitive dependency tree into the process that decides what it may do.
  MCP, globbing, diffing and SSE parsing are all implemented here.
- **Nothing in a repository can widen its own access.** Project config may
  only make VinaX stricter; project instruction files are conventions, not
  privileges; tool output is data, never instructions.

---

## 2. Architecture

```
        the user                             the developer's machine
            │                                          ▲
            ▼                                          │
   ┌──────────────────┐                                │
   │   vinax (this)   │ ── permission policy ──────────┘
   │                  │        (ask / auto-edit / full-auto)
   │  agent loop      │
   └────────┬─────────┘
            │  POST /api/vinaxcli/agent      (vinax-cli/1, SSE)
            ▼
   ┌──────────────────┐
   │  VinaX Worker    │  owns the system prompt, the tool vocabulary,
   │  backend/worker  │  argument validation, rate limits and EVERY key
   └────────┬─────────┘
            ▼
      VinaX engines
```

One step of the loop:

1. `agent/loop.ts` builds a request: the conversation, the tool results from
   the previous step, the project context and the project instruction file.
2. `api/client.ts` streams the response and yields normalized VinaX events.
   Provider-shaped anything never reaches the rest of the package.
3. Each `tool_call` goes to `tools/registry.ts`, which checks the run journal
   for a duplicate id, then dispatches.
4. The tool asks `permissions/policy.ts` before doing anything with an effect.
5. The result is redacted, clipped, journalled and returned to the Worker on
   the next step.

The loop ends when the task is done, the user interrupts, a permission is
refused, the step ceiling is hit, or an error cannot be recovered from — and
`RunOutcome.reason` says which, which is what the exit code is derived from.

### Endpoints it uses

| Endpoint | Purpose |
|---|---|
| `GET /api/vinaxcli/meta` | Protocol versions, engines, tool list, limits |
| `POST /api/vinaxcli/agent` | One agent step, as SSE |
| `POST /api/vinaxcli/search` | The `web_search` tool's back end |
| `GET /api/aimodels` | The live free-model catalogue for selectable engines |

---

## 3. Directory structure

```
cli/
├── src/
│   ├── cli.ts                  the binary: parse, dispatch, exit code
│   ├── index.ts                library surface (used by the e2e suite)
│   ├── version.ts              CLI_VERSION, kept in step with package.json
│   ├── commands/               run, controller, doctor, mcp, help
│   ├── config/                 args parsing, config precedence, ~/.vinax
│   ├── api/                    VinaX service client + SSE parser
│   ├── protocol/               the client half of vinax-cli/1
│   ├── agent/                  the loop, the task ledger, compaction
│   ├── context/                startup discovery, VINAX.md
│   ├── tools/
│   │   ├── filesystem/         read, write, search, diff
│   │   ├── process/            runner + run_command / run_shell
│   │   ├── git/                typed git operations
│   │   └── mcp/                stdio MCP client
│   ├── permissions/            the policy engine
│   ├── security/               workspace boundaries, secrets, command risk
│   ├── session/                JSONL sessions, the run journal, undo
│   ├── terminal/               rendering, prompts, slash commands
│   ├── project/                globs and ignore rules
│   └── utils/                  exit codes, text helpers
├── tests/                      13 suites, incl. a full end-to-end agent run
└── scripts/postbuild.mjs       shebang check + chmod on dist/cli.js
```

---

## 4. Local development

Three terminals, the usual VinaX layout:

```sh
# 1 — the Worker (wrangler dev on :8787)
cd backend && npm ci && npm run dev

# 2 — the CLI, pointed at that Worker
cd cli && npm ci
VINAX_API_BASE=http://127.0.0.1:8787 npm run dev

# 3 — only when you are also changing the docs page
cd frontend && npm ci && npm run dev
```

`npm run dev` runs `src/cli.ts` directly through Node's TypeScript stripping,
so there is no build step in the edit loop. To pass flags:

```sh
VINAX_API_BASE=http://127.0.0.1:8787 node --experimental-strip-types src/cli.ts --full-auto -p "explain this repo"
```

### The API base override

`VINAX_API_BASE` exists **only** for this package and for development tooling.
It must never appear in the browser frontend, which calls same-origin relative
paths and has no CORS. A project config that tries to set `apiBase` is refused
and the user is told — a repository does not get to redirect somebody else's
agent traffic.

---

## 5. The protocol

`vinax-cli/1`. Defined once, on the server, in
`backend/worker/functions/_lib/cliprotocol.ts`; the client half is
`src/protocol/events.ts`.

Request:

```jsonc
{
  "protocol": "vinax-cli/1",
  "requestId": "req_…",
  "runId": "run_…",
  "step": 3,
  "engine": "auto",
  "model": null,
  "web": false,
  "messages":    [{ "role": "user", "content": "…" }],
  "toolResults": [{ "id": "call_…", "name": "read_file", "ok": true, "content": "…" }],
  "project":     { "instructions": "…VINAX.md…", "context": "…git state…" },
  "client":      { "version": "0.1.0", "platform": "linux" }
}
```

Events, as SSE:

| Event | Meaning |
|---|---|
| `hello` | Protocol and limits for this step |
| `engine` | Which seat and model answered |
| `status` | Factual state, never reasoning |
| `assistant_delta` | Text for the user |
| `tool_call` | A validated tool request |
| `usage` | Token counts, when the provider reports them |
| `warning` | Something the user should know |
| `error` | `recoverable: true` means the model can retry from it |
| `done` | `tool_calls` \| `final` \| `empty` |

Every event carries `runId`, `requestId`, `step` and a monotonic `seq`.

**The client never sends a system prompt.** A `system` field is rejected with
`system_prompt_rejected`, and a `system` role inside `messages` is dropped.

**Tool calls are normalized server-side.** Whether the engine emitted native
`tool_calls` deltas or the server-controlled text form, the CLI receives the
same `tool_call` event and never learns which happened. Arguments are
validated against the server schema — unknown tool, wrong type, unknown
argument, oversized payload — before anything reaches a device; a failure is a
recoverable protocol error, never an execution.

---

## 6. Security model

| Concern | Where it lives | What it does |
|---|---|---|
| Workspace boundaries | `security/paths.ts` | Resolves the real path through every symlink, then compares by path segments against approved roots. Never a string prefix. |
| Credential files | `security/secrets.ts` | `.env`, keys, service accounts, `.ssh`/`.aws`/`.kube` and friends need explicit approval, and the user is told the contents become model context. |
| Output redaction | `security/secrets.ts` | Private key blocks, authorization headers, provider token shapes, JWTs, URL userinfo and secret-named values are scrubbed from every tool result. |
| Command risk | `security/risk.ts` | Classifies argv (and each segment of a shell line) as routine / elevated / critical. Critical is confirmed in **every** mode. |
| Permission policy | `permissions/policy.ts` | The three modes. `autoAllowed()` is the whole policy in one readable function. |
| Idempotency | `session/journal.ts` | Executed call ids are recorded; a repeat replays instead of re-running. A dropped stream cannot become a second commit. |
| Undo | `session/journal.ts` | Restores VinaX's own edits, and refuses when the file changed since. Never a global `git reset`. |
| Prompt injection | `backend/.../cliprompt.ts` | The agent contract states that tool output, project files, READMEs, logs and web pages are data. Project instruction files are subordinate to it by construction. |

Things that deliberately **do not exist** in the tool set: `git reset --hard`,
`git clean`, checkout-that-discards, force push, remote branch deletion,
history rewriting, and any recursive directory delete.

---

## 7. Testing

```sh
cd cli
npm test              # 299 tests / 13 files
npm run lint
npm run typecheck
```

The suites, and what each is really for:

| Suite | Proves |
|---|---|
| `args` | Flag parsing, including that `-p` is not clobbered by positionals |
| `config` | Precedence, and that a project config cannot escalate privileges |
| `security` | Traversal, symlink escape (incl. nested), redaction, command risk |
| `transport` | SSE reassembly from arbitrary chunk boundaries, typed API errors |
| `filesystem` | Reads, edits, atomic writes, race detection, protected files |
| `process` | Real children: streaming, timeout, cancel, child-**tree** kill |
| `permissions` | What each mode allows, and what nothing allows |
| `git` | Real repositories, real commits, a real push to a bare remote |
| `session` | JSONL recovery from a torn write, undo, duplicate-call protection |
| `mcp` | A real stdio server, and that its tools get no extra privileges |
| `discovery` | Startup facts, instruction files, ignore rules, rendering |
| `package` | Version sync, help completeness, `npm pack` contents |
| `e2e-agent` | The **compiled binary** fixing a real broken project |

`e2e-agent` is the one that matters most. It starts a mock VinaX agent server,
creates a project with a genuine one-character bug, and runs `dist/cli.js`
against it. The assertions are on the file on disk, the real test output the
CLI sent back, the commit hash Git returned and the process exit code — not on
anything the model said. **It needs `npm run build` first.**

Every suite works in a temporary directory. Git suites set
`GIT_CONFIG_GLOBAL=/dev/null` so they cannot see or affect the developer's own
Git configuration, and they skip themselves when Git is not installed.

No test needs a network, a production secret or a real engine.

---

## 8. Building and packaging

```sh
npm run build         # tsc → dist/, then postbuild (shebang check + chmod)
npm pack --dry-run    # what would actually ship
```

`src/cli.ts` starts with a shebang; TypeScript preserves it, and
`scripts/postbuild.mjs` fails the build if it ever stops doing so — a binary
that lost its shebang is a binary that does not run.

The published package contains `dist/`, `README.md` and `package.json`. The
`package` suite asserts that tests, sources, configs, lockfiles, `.env` files
and source maps are all absent.

**Do not publish to npm** unless publishing credentials and package ownership
are already explicitly configured for this package.

---

## 9. Release process

1. Change the code, add or update the tests that hold it.
2. Bump `cli/package.json` **and** `src/version.ts` together — `package.test.ts`
   fails if they drift.
3. `npm run lint && npm run typecheck && npm test && npm run build && npm pack --dry-run`.
4. If the protocol changed in a way an older client cannot speak, add the new
   id to `SUPPORTED_PROTOCOLS` on the Worker and keep the old one until
   clients have had time to update. `vinax doctor` reports a mismatch clearly.
5. The frontend release contract still applies for anything under `frontend/`
   (version bump + changelog entry) — see the root README, §8.8.

---

## 10. Troubleshooting

| Symptom | Cause |
|---|---|
| `command not found: vinax` | Not installed globally, or run `node dist/cli.js` from `cli/`. |
| `protocol_mismatch` | The CLI and the Worker disagree. Update one; `vinax doctor` says which. |
| `engine_unavailable` | That engine's key is not configured on the Worker. `--engine auto` routes around it. |
| E2E suite fails to start | `dist/cli.js` is missing. Run `npm run build`. |
| Git suites skip | Git is not on PATH. That is expected and not a failure. |
| A child process outlives a run | Should be impossible — `runProcess` detaches into its own process group and `killTree` signals the group. If you see it, it is a bug worth a test. |
