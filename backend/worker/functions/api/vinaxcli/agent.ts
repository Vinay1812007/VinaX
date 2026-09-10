/**
 * POST /api/vinaxcli/agent — one step of a VinaX CLI agent run.
 *
 * This is deliberately NOT the assistant endpoint with tools bolted on. A
 * chat endpoint answers a person; this one drives a process that can write to
 * somebody's disk, so it is a separate route with its own contract, its own
 * validation and its own budget.
 *
 * Division of powers, which is the whole security story:
 *
 *   the model     decides what it wants done, and can do nothing itself
 *   this Worker   owns the system prompt, the tool vocabulary and the
 *                 validation; it holds every provider key and touches no
 *                 device
 *   the CLI       owns the device; it applies the user's permission policy to
 *                 every validated call and is free to refuse
 *
 * A step is: messages in, a normalized event stream out. The stream ends
 * either with tool calls the client must execute, or with a final answer.
 * The loop lives in the client, because only the client can run the tools.
 */
import {
  LANE_MODEL,
  laneAttempts,
  laneEndpoint,
  logAiEvent,
  isExternalEndpoint,
  reasoningOffParams,
  type AiEnv,
  type Lane,
} from '../../_lib/ai';
import { catalogDefaultModel, resolveCatalogModel } from '../../_lib/catalog';
import { methodNotAllowed, rateLimit } from '../../_lib/ratelimit';
import { type SupabaseEnv } from '../../_lib/supabase';
import {
  CLI_PROTOCOL,
  LIMITS,
  SUPPORTED_PROTOCOLS,
  toolsFor,
  validateToolCall,
  type ToolCallRequest,
} from '../../_lib/cliprotocol';
import {
  buildAgentSystemPrompt,
  projectContextBlock,
  projectInstructionBlock,
  toolResultBlock,
  userTurnBlock,
} from '../../_lib/cliprompt';
import { cliEngine, engineAvailable, pickAutoEngine, type CliEngine } from '../../_lib/cliengines';
import {
  createNativeToolAccumulator,
  createToolStreamParser,
  parseUpstreamLine,
} from '../../_lib/clistream';

type Env = AiEnv & SupabaseEnv & { TELEMETRY_PEPPER?: string };

interface WireMessage {
  role?: unknown;
  content?: unknown;
}
interface WireToolResult {
  id?: unknown;
  name?: unknown;
  ok?: unknown;
  content?: unknown;
  error?: unknown;
}
interface WireBody {
  protocol?: unknown;
  requestId?: unknown;
  runId?: unknown;
  step?: unknown;
  engine?: unknown;
  model?: unknown;
  web?: unknown;
  messages?: unknown;
  toolResults?: unknown;
  project?: unknown;
  client?: unknown;
  /** Explicitly rejected — the agent contract is server-owned. */
  system?: unknown;
}

const clean = (s: string): string =>
  [...s].filter((ch) => ch === '\n' || ch === '\t' || ch.charCodeAt(0) >= 32).join('');

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: {
  request: Request;
  env: Env;
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> => {
  const { request, env, waitUntil } = context;
  // An agent run is many inference calls for one human intention, so the
  // budget is per-step and generous compared with chat — but a budget all the
  // same: an endpoint that will happily run an unbounded loop on somebody
  // else's key is not an endpoint, it is a donation.
  const limited = rateLimit(request, 'vinaxcli-agent', { capacity: 40, refillPerMinute: 30 }, env);
  if (limited) return limited;
  try {
    return await handleStep(request, env, waitUntil);
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.warn('[vinaxcli] unhandled exception:', message);
    return json({ error: 'exception', message: 'internal_error' }, 500);
  }
};

async function handleStep(
  request: Request,
  env: Env,
  waitUntil: ((p: Promise<unknown>) => void) | undefined,
): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > LIMITS.maxBodyBytes) {
    return json({ error: 'payload_too_large', message: `body exceeds ${LIMITS.maxBodyBytes} bytes` }, 413);
  }

  const raw = await request.text().catch(() => '');
  if (raw.length > LIMITS.maxBodyBytes) {
    return json({ error: 'payload_too_large', message: `body exceeds ${LIMITS.maxBodyBytes} bytes` }, 413);
  }
  let body: WireBody;
  try {
    body = JSON.parse(raw) as WireBody;
  } catch {
    return json({ error: 'bad_request', message: 'body must be JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'bad_request', message: 'body must be a JSON object' }, 400);
  }

  const protocol = typeof body.protocol === 'string' ? body.protocol : '';
  if (!SUPPORTED_PROTOCOLS.includes(protocol)) {
    return json(
      {
        error: 'protocol_mismatch',
        message: `this server speaks ${SUPPORTED_PROTOCOLS.join(', ')}`,
        supported: SUPPORTED_PROTOCOLS,
      },
      400,
    );
  }

  const step = typeof body.step === 'number' && Number.isFinite(body.step) ? Math.floor(body.step) : 1;
  if (step < 1) return json({ error: 'bad_request', message: 'step must be >= 1' }, 400);
  if (step > LIMITS.maxSteps) {
    return json(
      { error: 'max_steps', message: `a run may take at most ${LIMITS.maxSteps} steps`, maxSteps: LIMITS.maxSteps },
      429,
    );
  }

  const requestId = safeId(body.requestId, 'req');
  const runId = safeId(body.runId, 'run');
  const web = body.web === true;
  const platform = readPlatform(body.client);

  // The agent contract is server-owned. A client that tries to send one is
  // told plainly rather than silently ignored — a silent drop would let a
  // caller believe it had changed the agent's rules.
  if (body.system !== undefined) {
    return json(
      { error: 'system_prompt_rejected', message: 'the VinaX CLI agent contract is server-owned and cannot be supplied by a client' },
      400,
    );
  }

  // ---- messages ----------------------------------------------------------
  const wire = Array.isArray(body.messages) ? (body.messages as WireMessage[]) : [];
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of wire.slice(-LIMITS.maxMessages)) {
    const role = m?.role;
    if (role !== 'user' && role !== 'assistant') continue; // 'system' from a client is dropped
    if (typeof m.content !== 'string') continue;
    const content = clean(m.content).slice(0, LIMITS.maxMessageChars);
    if (!content) continue;
    history.push({ role, content });
  }
  if (!history.length) return json({ error: 'bad_request', message: 'at least one user message is required' }, 400);

  // ---- tool results ------------------------------------------------------
  const wireResults = Array.isArray(body.toolResults) ? (body.toolResults as WireToolResult[]) : [];
  if (wireResults.length > LIMITS.maxToolResults) {
    return json({ error: 'bad_request', message: `at most ${LIMITS.maxToolResults} tool results per step` }, 400);
  }
  const results = wireResults
    .filter((r) => typeof r?.id === 'string' && typeof r?.name === 'string')
    .map((r) => ({
      id: String(r.id).slice(0, 64),
      name: String(r.name).slice(0, 64),
      ok: r.ok !== false,
      content: clean(typeof r.content === 'string' ? r.content : typeof r.error === 'string' ? r.error : '')
        .slice(0, LIMITS.maxToolResultChars),
    }));

  // ---- project context ---------------------------------------------------
  const project = (body.project ?? {}) as { instructions?: unknown; context?: unknown };
  const instructions =
    typeof project.instructions === 'string' ? clean(project.instructions).slice(0, LIMITS.maxInstructionChars) : '';
  const projectState =
    typeof project.context === 'string' ? clean(project.context).slice(0, LIMITS.maxContextChars) : '';

  // ---- engine + model ----------------------------------------------------
  const requested = typeof body.engine === 'string' ? body.engine : 'auto';
  let engine: CliEngine | null = cliEngine(requested);
  if (!engine) {
    return json({ error: 'invalid_engine', message: `unknown engine "${String(requested).slice(0, 32)}"` }, 400);
  }
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  if (engine.id === 'auto') engine = pickAutoEngine(lastUser.slice(0, 2000));
  if (!engineAvailable(env, engine)) {
    return json(
      { error: 'engine_unavailable', message: `the ${engine.label} engine is not configured on this service` },
      503,
    );
  }

  const wantedModel = typeof body.model === 'string' ? body.model.trim() : '';
  let model: string | undefined;
  if (wantedModel) {
    if (!engine.acceptsModel || !engine.catalog) {
      return json(
        { error: 'model_not_selectable', message: `the ${engine.label} engine does not take a model id` },
        400,
      );
    }
    const resolved = await resolveCatalogModel(env, engine.catalog, wantedModel);
    if (!resolved) {
      return json(
        {
          error: 'invalid_model',
          message: 'that model is not in this engine\'s live free catalog right now',
          catalogEndpoint: '/api/aimodels',
        },
        400,
      );
    }
    model = resolved;
  } else if (engine.acceptsModel && engine.catalog) {
    // A catalog key serves no fixed model; resolve the default from the live
    // list rather than trusting a pin that the provider may have retired.
    const fallback = await catalogDefaultModel(env, engine.catalog);
    if (!fallback) {
      return json(
        { error: 'engine_unavailable', message: `the ${engine.label} engine has no model available right now` },
        503,
      );
    }
    model = fallback;
  }

  // ---- prompt ------------------------------------------------------------
  const tools = toolsFor({ web });
  const system = buildAgentSystemPrompt({ tools, web, platform, maxSteps: LIMITS.maxSteps });

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [{ role: 'system', content: system }];
  if (instructions) messages.push({ role: 'system', content: projectInstructionBlock(instructions) });
  if (projectState) messages.push({ role: 'system', content: projectContextBlock(projectState) });
  for (const m of history) {
    messages.push(m.role === 'user' ? { role: 'user', content: userTurnBlock(m.content) } : m);
  }
  if (results.length) {
    messages.push({
      role: 'user',
      content: results.map((r) => toolResultBlock(r)).join('\n\n'),
    });
  }

  return streamStep({ env, waitUntil, engine, model, messages, web, requestId, runId, step });
}

/* -------------------------------------------------------------------------- */
/* Streaming                                                                  */
/* -------------------------------------------------------------------------- */

interface StreamArgs {
  env: Env;
  waitUntil?: (p: Promise<unknown>) => void;
  engine: CliEngine;
  model?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  web: boolean;
  requestId: string;
  runId: string;
  step: number;
}

async function streamStep(a: StreamArgs): Promise<Response> {
  const { env, engine, messages } = a;
  const lane: Lane = engine.lane;
  const attempts = laneAttempts(env, lane, a.model);
  const t0 = Date.now();

  let upstream: Response | null = null;
  let usedModel = a.model ?? LANE_MODEL[lane];
  let usedRole: string = lane;
  let lastStatus = 0;

  // Open the upstream BEFORE returning a stream: a failure that happens
  // before any byte is forwarded is an honest HTTP error the CLI can retry,
  // not a half-written stream it has to reason about.
  for (const attempt of attempts) {
    const payload: Record<string, unknown> = {
      model: attempt.model,
      // Tool syntax has to come back byte-exact, so this seat runs cold.
      temperature: 0.2,
      max_tokens: 8000,
      stream: true,
      stream_options: { include_usage: true },
      messages,
    };
    if (attempt.model.includes('gpt-oss') && !isExternalEndpoint(attempt.endpoint)) payload.reasoning_effort = 'low';
    Object.assign(payload, reasoningOffParams(attempt.model));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    let res: Response;
    try {
      res = await fetch(attempt.endpoint || laneEndpoint(env, lane), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${attempt.key}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      lastStatus = 0;
      continue;
    }
    clearTimeout(timer);
    if (res.ok && res.body) {
      upstream = res;
      usedModel = attempt.model;
      usedRole = attempt.role;
      break;
    }
    lastStatus = res.status;
  }

  if (!upstream || !upstream.body) {
    if (a.waitUntil) {
      a.waitUntil(
        logAiEvent(env, {
          feature: 'assistant',
          model: `cli:${usedModel} @${usedRole}`,
          ok: false,
          status: lastStatus || 503,
          error: `http_${lastStatus || 0}`,
          client: 'web',
          latency_ms: Date.now() - t0,
        }),
      );
    }
    return json(
      { error: 'upstream_unavailable', message: 'no VinaX engine could serve this step', status: lastStatus },
      503,
    );
  }

  const upBody = upstream.body;
  const encoder = new TextEncoder();
  let seq = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (type: string, data: Record<string, unknown>): void => {
        seq += 1;
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type, seq, runId: a.runId, requestId: a.requestId, step: a.step, ...data })}\n\n`,
          ),
        );
      };

      send('hello', { protocol: CLI_PROTOCOL, maxSteps: LIMITS.maxSteps, maxCallsPerStep: LIMITS.maxCallsPerStep });
      send('engine', { engine: engine.id, label: engine.label, model: usedModel, web: a.web });
      send('status', { status: 'thinking' });

      const parser = createToolStreamParser();
      const native = createNativeToolAccumulator();
      const calls: ToolCallRequest[] = [];
      const usage = { prompt: 0, completion: 0, seen: false };
      let textLen = 0;
      let overflow = false;

      const emitCalls = (rawJson: string[]): void => {
        for (const raw of rawJson) {
          if (calls.length >= LIMITS.maxCallsPerStep) {
            if (!overflow) {
              overflow = true;
              send('warning', {
                code: 'too_many_tool_calls',
                message: `only the first ${LIMITS.maxCallsPerStep} tool calls of this step are executed`,
              });
            }
            continue;
          }
          const id = `call_${a.runId.slice(-6)}_${a.step}_${calls.length + 1}`;
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            send('error', {
              code: 'tool_parse_error',
              recoverable: true,
              message: 'a tool block was not valid JSON; the model should re-emit it',
            });
            continue;
          }
          const v = validateToolCall(parsed, { web: a.web, id });
          if (!v.ok || !v.call) {
            send('error', {
              code: v.error ?? 'tool_invalid',
              recoverable: true,
              message: v.detail ?? 'the model requested a tool call that failed validation',
            });
            continue;
          }
          calls.push(v.call);
          send('tool_call', { id: v.call.id, name: v.call.name, arguments: v.call.arguments });
        }
      };

      try {
        const reader = upBody.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const delta = parseUpstreamLine(line.slice(5));
            if (!delta) continue;
            if (delta.usage) {
              usage.prompt += delta.usage.prompt_tokens;
              usage.completion += delta.usage.completion_tokens;
              usage.seen = true;
            }
            if (delta.toolCalls) native.add(delta.toolCalls);
            if (delta.content) {
              const out = parser.push(delta.content);
              if (out.text) {
                textLen += out.text.length;
                send('assistant_delta', { text: out.text });
              }
              if (out.calls.length) emitCalls(out.calls);
            }
            if (delta.done) break;
          }
        }
        const tail = parser.end();
        if (tail.text) {
          textLen += tail.text.length;
          send('assistant_delta', { text: tail.text });
        }
        if (tail.calls.length) emitCalls(tail.calls);

        // A provider that speaks native tool calling gets normalized into the
        // exact same events — the CLI never learns which happened.
        for (const n of native.finish()) {
          let args: unknown = {};
          if (n.arguments) {
            try {
              args = JSON.parse(n.arguments);
            } catch {
              args = {};
            }
          }
          emitCalls([JSON.stringify({ name: n.name, arguments: args })]);
        }
      } catch {
        send('error', { code: 'stream_interrupted', recoverable: true, message: 'the engine stream ended unexpectedly' });
      }

      if (usage.seen) send('usage', { inputTokens: usage.prompt, outputTokens: usage.completion });
      const reason = calls.length ? 'tool_calls' : textLen ? 'final' : 'empty';
      if (reason === 'empty') {
        send('error', { code: 'empty_reply', recoverable: true, message: 'the engine returned nothing for this step' });
      }
      send('done', { reason, toolCalls: calls.length });
      controller.close();

      if (a.waitUntil) {
        a.waitUntil(
          logAiEvent(env, {
            feature: 'assistant',
            model: `cli:${usedModel} @${usedRole}`,
            ok: reason !== 'empty',
            status: 200,
            error: reason === 'empty' ? 'empty' : null,
            client: 'web',
            latency_ms: Date.now() - t0,
            ...(usage.seen ? { prompt_tokens: usage.prompt, completion_tokens: usage.completion } : {}),
          }),
        );
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-vinax-protocol': CLI_PROTOCOL,
    },
  });
}

/** Accept a client-supplied id when it is sane, else mint one. */
function safeId(v: unknown, prefix: string): string {
  if (typeof v === 'string') {
    const s = v.trim();
    if (s && s.length <= 64 && /^[\w.:-]+$/.test(s)) return s;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function readPlatform(client: unknown): string {
  if (!client || typeof client !== 'object') return '';
  const p = (client as { platform?: unknown }).platform;
  if (typeof p !== 'string') return '';
  return /^[\w .-]{1,32}$/.test(p) ? p : '';
}
