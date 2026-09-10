/**
 * The agent loop.
 *
 * This is the product. Everything else in the package exists so that this
 * function can run:
 *
 *     user request → VinaX Worker → model → normalized tool request
 *                 → local permission policy → local tool execution
 *                 → tool result → model → next tool or final answer
 *
 * The model cannot execute anything. The Worker cannot touch this machine.
 * Only this loop can, and only through the registry, and only after the
 * permission engine has agreed. That separation is what makes an autonomous
 * coding agent something you can reasonably run on your own laptop.
 *
 * The loop ends when the task is done, the user interrupts, a permission is
 * refused, the step ceiling is reached, or an error cannot be recovered from
 * — and it reports which of those happened, honestly, every time.
 */
import { randomUUID } from 'node:crypto';
import { ApiError, type VinaxApi } from '../api/client.js';
import { PROTOCOL, type AgentEvent, type AgentRequest, type ToolResultWire } from '../protocol/events.js';
import { executeTool } from '../tools/registry.js';
import type { ToolContext, ToolUi } from '../tools/types.js';
import type { VinaxConfig } from '../config/config.js';
import type { PermissionEngine } from '../permissions/policy.js';
import type { Workspace } from '../security/paths.js';
import type { RunJournal } from '../session/journal.js';
import type { SessionStore } from '../session/store.js';
import type { McpRegistry } from '../tools/mcp/client.js';
import { TaskLedger } from './ledger.js';
import { compact, type Turn } from './context.js';
import { contextBlock, type Discovery } from '../context/discovery.js';
import { CLI_VERSION } from '../version.js';

export type StopReason =
  | 'completed'
  | 'interrupted'
  | 'permission_denied'
  | 'max_steps'
  | 'api_error'
  | 'tool_failure';

export interface RunOutcome {
  reason: StopReason;
  finalText: string;
  steps: number;
  /** Set when the run stopped because something went wrong. */
  error: string | null;
}

/** Everything the loop reports as it happens, for the terminal and --json. */
export interface AgentObserver {
  engine(info: { engine: string; label: string; model: string; web: boolean }): void;
  status(status: string): void;
  assistantDelta(text: string): void;
  assistantEnd(): void;
  toolCall(call: { id: string; name: string; arguments: Record<string, unknown> }): void;
  toolResult(result: { id: string; name: string; ok: boolean; content: string }): void;
  usage(u: { inputTokens: number; outputTokens: number }): void;
  warning(w: { code: string; message: string }): void;
  error(e: { code: string; message: string; recoverable: boolean }): void;
  permissionRequired(info: { action: string; message: string }): void;
  compacted(info: { droppedTurns: number; tokensBefore: number; tokensAfter: number }): void;
}

export interface LoopDeps {
  api: VinaxApi;
  config: VinaxConfig;
  ws: Workspace;
  permissions: PermissionEngine;
  journal: RunJournal;
  ledger: TaskLedger;
  mcp: McpRegistry | null;
  session: SessionStore | null;
  discovery: Discovery;
  ui: ToolUi;
  observer: AgentObserver;
  /** The running conversation, mutated in place so /resume and /compact see it. */
  conversation: Turn[];
}

/** One assistant turn's record of what it did, so the model keeps continuity. */
function actionRecord(calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): string {
  if (!calls.length) return '';
  const lines = calls.map((c) => {
    const args = JSON.stringify(c.arguments);
    return `[VinaX ran ${c.name} ${args.length > 300 ? `${args.slice(0, 300)}…` : args} as ${c.id}]`;
  });
  return `\n\n${lines.join('\n')}`;
}

export async function runAgentTurn(
  deps: LoopDeps,
  userText: string,
  signal: AbortSignal,
): Promise<RunOutcome> {
  const { api, config, observer, conversation, ledger } = deps;
  const runId = `run_${randomUUID().slice(0, 8)}`;
  conversation.push({ role: 'user', content: userText });
  await deps.session?.append({ t: 'user', at: Date.now(), text: userText });
  if (!ledger.goal) ledger.goal = userText.replace(/\s+/g, ' ').slice(0, 160);

  let pendingResults: ToolResultWire[] = [];
  /** Files already written to the session transcript this turn. */
  const loggedFiles = new Set<string>();
  let loggedCommand: (typeof ledger.commands)[number] | null = null;
  let finalText = '';
  let step: number;

  for (step = 1; step <= config.maxSteps; step += 1) {
    if (signal.aborted) {
      ledger.setState('Interrupted');
      return { reason: 'interrupted', finalText, steps: step - 1, error: null };
    }
    ledger.steps = step;

    // Compact before building the request, so the request itself is the
    // smaller one rather than the one that just failed for being too big.
    const squeezed = compact(conversation, ledger, { budgetTokens: 120_000, keepRecent: 8 });
    if (squeezed.summary) {
      conversation.length = 0;
      conversation.push(...squeezed.turns);
      observer.compacted({
        droppedTurns: squeezed.droppedTurns,
        tokensBefore: squeezed.tokensBefore,
        tokensAfter: squeezed.tokensAfter,
      });
    }

    const request: AgentRequest = {
      protocol: PROTOCOL,
      requestId: `req_${randomUUID().slice(0, 8)}`,
      runId,
      step,
      engine: config.engine,
      model: config.model,
      web: config.web,
      messages: conversation.map((t) => ({ role: t.role, content: t.content })),
      toolResults: pendingResults,
      project: { instructions: deps.discovery.instructions, context: contextBlock(deps.discovery) },
      client: { version: CLI_VERSION, platform: process.platform },
    };
    pendingResults = [];

    let text = '';
    const calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    let doneReason: 'tool_calls' | 'final' | 'empty' | null = null;
    let sawAnyEvent = false;

    try {
      for await (const ev of streamWithRetry(api, request, signal, sawAnyEvent)) {
        sawAnyEvent = true;
        handleEvent(ev, deps, { onText: (t) => { text += t; }, onCall: (c) => calls.push(c), onDone: (r) => { doneReason = r; } });
      }
    } catch (e) {
      if (signal.aborted) {
        ledger.setState('Interrupted');
        return { reason: 'interrupted', finalText: text || finalText, steps: step, error: null };
      }
      const err = e instanceof ApiError ? e : new ApiError('network', e instanceof Error ? e.message : String(e));
      observer.error({ code: err.code, message: err.message, recoverable: false });
      ledger.setState('Failed');
      return { reason: 'api_error', finalText, steps: step, error: err.message };
    }

    if (text.trim()) {
      observer.assistantEnd();
      await deps.session?.append({ t: 'assistant', at: Date.now(), text: text.trim() });
    }
    conversation.push({ role: 'assistant', content: `${text.trim()}${actionRecord(calls)}`.trim() || '(no reply)' });

    if (!calls.length) {
      finalText = text.trim();
      if (doneReason === 'empty') {
        ledger.setState('Failed');
        return { reason: 'api_error', finalText, steps: step, error: 'the engine returned nothing' };
      }
      ledger.setState('Completed');
      return { reason: 'completed', finalText, steps: step, error: null };
    }

    // ---- execute the requested tools -------------------------------------
    const ctx: ToolContext = {
      ws: deps.ws,
      config,
      permissions: deps.permissions,
      journal: deps.journal,
      ledger,
      api,
      ui: deps.ui,
      mcp: deps.mcp,
      signal,
      editGroup: `${runId}:${step}`,
    };

    for (const call of calls) {
      if (signal.aborted) {
        ledger.setState('Interrupted');
        return { reason: 'interrupted', finalText: text.trim(), steps: step, error: null };
      }
      await deps.session?.append({ t: 'tool_call', at: Date.now(), id: call.id, name: call.name, arguments: call.arguments });
      const result = await executeTool(call, ctx);
      observer.toolResult({ id: call.id, name: call.name, ok: result.ok, content: result.content });
      await deps.session?.append({ t: 'tool_result', at: Date.now(), id: call.id, name: call.name, ok: result.ok, content: result.content.slice(0, 20_000) });
      // Record only what this call newly changed. Re-logging the whole set
      // after every tool would fill the transcript with duplicates and make a
      // resumed session's file list quadratic in the number of steps.
      for (const f of ledger.filesChanged) {
        if (loggedFiles.has(f)) continue;
        loggedFiles.add(f);
        await deps.session?.append({ t: 'file_changed', at: Date.now(), path: f });
      }
      pendingResults.push({ id: call.id, name: call.name, ok: result.ok, content: result.content });
      const lastCommand = ledger.commands[ledger.commands.length - 1];
      if (lastCommand && lastCommand !== loggedCommand) {
        loggedCommand = lastCommand;
        await deps.session?.append({
          t: 'command',
          at: Date.now(),
          command: lastCommand.command,
          exitCode: lastCommand.exitCode,
          summary: lastCommand.summary,
        });
      }

      if (result.permissionDenied) {
        // A refusal is the user's decision and ends the run. Carrying on and
        // trying another route to the same effect would be exactly the
        // behaviour the prompt forbids.
        ledger.setState('Blocked');
        ledger.blockers.push(`${call.name} was not permitted`);
        observer.permissionRequired({ action: call.name, message: result.content });
        await deps.session?.append({ t: 'permission', at: Date.now(), action: call.name, outcome: 'denied' });
        return { reason: 'permission_denied', finalText: text.trim(), steps: step, error: result.content };
      }
    }
    await deps.session?.checkpoint();
  }

  ledger.setState('Blocked');
  return {
    reason: 'max_steps',
    finalText,
    steps: step - 1,
    error: `Stopped after ${config.maxSteps} steps without finishing. The session is preserved — say "continue" to carry on.`,
  };
}

/** Route one event to the observer, the ledger and the session log. */
function handleEvent(
  ev: AgentEvent,
  deps: LoopDeps,
  sink: {
    onText: (t: string) => void;
    onCall: (c: { id: string; name: string; arguments: Record<string, unknown> }) => void;
    onDone: (r: 'tool_calls' | 'final' | 'empty') => void;
  },
): void {
  const { observer, ledger } = deps;
  switch (ev.type) {
    case 'hello':
      break;
    case 'engine':
      observer.engine({ engine: ev.engine, label: ev.label, model: ev.model, web: ev.web });
      break;
    case 'status':
      ledger.setState(ev.status === 'thinking' ? 'Planning' : ledger.state);
      observer.status(ev.status);
      break;
    case 'assistant_delta':
      sink.onText(ev.text);
      observer.assistantDelta(ev.text);
      break;
    case 'tool_call':
      sink.onCall({ id: ev.id, name: ev.name, arguments: ev.arguments });
      observer.toolCall({ id: ev.id, name: ev.name, arguments: ev.arguments });
      break;
    case 'usage':
      ledger.inputTokens += ev.inputTokens;
      ledger.outputTokens += ev.outputTokens;
      observer.usage({ inputTokens: ev.inputTokens, outputTokens: ev.outputTokens });
      break;
    case 'warning':
      observer.warning({ code: ev.code, message: ev.message });
      break;
    case 'error':
      observer.error({ code: ev.code, message: ev.message, recoverable: ev.recoverable === true });
      break;
    case 'done':
      sink.onDone(ev.reason);
      break;
  }
}

/**
 * Stream one step, retrying ONLY when nothing was received.
 *
 * The distinction is the whole safety property. A request that failed before
 * any byte arrived produced no tool calls and therefore no side effects, so
 * retrying it is free. Once a single event has been delivered the client may
 * already have executed something on this machine, and a blind retry could
 * commit twice or install twice — so from that point the failure is reported
 * rather than repeated. (The journal's call-id check is the second line of
 * defence for the case where the model reissues the same call itself.)
 */
async function* streamWithRetry(
  api: VinaxApi,
  request: AgentRequest,
  signal: AbortSignal,
  alreadyStarted: boolean,
): AsyncGenerator<AgentEvent, void, void> {
  const maxAttempts = alreadyStarted ? 1 : 3;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    let started = false;
    try {
      for await (const ev of api.agent(request, signal)) {
        started = true;
        yield ev;
      }
      return;
    } catch (e) {
      if (started || signal.aborted || attempt >= maxAttempts) throw e;
      const err = e instanceof ApiError ? e : null;
      // A rate limit and a bad request are not the same problem: honour the
      // server's own retry hint, and never retry something it rejected.
      if (err && ['protocol_mismatch', 'invalid_engine', 'invalid_model', 'model_not_selectable', 'system_prompt_rejected', 'bad_request', 'max_steps'].includes(err.code)) {
        throw e;
      }
      const waitMs = err?.retryAfter ? Math.min(err.retryAfter * 1000, 30_000) : attempt * 1200;
      await sleep(waitMs, signal);
      if (signal.aborted) throw e;
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
