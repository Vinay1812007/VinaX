/**
 * The client half of `vinax-cli/1`.
 *
 * These types describe exactly what the CLI is allowed to expect from the
 * VinaX agent endpoint, and the parser below is defensive about all of it: a
 * malformed event becomes a warning the run can carry on past, never a crash
 * halfway through somebody's refactor.
 */

export const PROTOCOL = 'vinax-cli/1';

export interface EventBase {
  type: string;
  seq: number;
  runId: string;
  requestId: string;
  step: number;
}

export type AgentEvent =
  | (EventBase & { type: 'hello'; protocol: string; maxSteps: number; maxCallsPerStep: number })
  | (EventBase & { type: 'engine'; engine: string; label: string; model: string; web: boolean })
  | (EventBase & { type: 'status'; status: string })
  | (EventBase & { type: 'assistant_delta'; text: string })
  | (EventBase & { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> })
  | (EventBase & { type: 'usage'; inputTokens: number; outputTokens: number })
  | (EventBase & { type: 'warning'; code: string; message: string })
  | (EventBase & { type: 'error'; code: string; message: string; recoverable?: boolean })
  | (EventBase & { type: 'done'; reason: 'tool_calls' | 'final' | 'empty'; toolCalls: number });

/** One tool result travelling back to the Worker. */
export interface ToolResultWire {
  id: string;
  name: string;
  ok: boolean;
  content: string;
}

export interface AgentRequest {
  protocol: string;
  requestId: string;
  runId: string;
  step: number;
  engine: string;
  model: string | null;
  web: boolean;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  toolResults: ToolResultWire[];
  project: { instructions: string; context: string };
  client: { version: string; platform: string };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const n = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Turn one decoded SSE payload into a typed event, or null if it is not one.
 *
 * Unknown event types return null rather than throwing: a newer server may
 * add events an older client has never heard of, and the correct response to
 * that is to ignore them and keep working.
 */
export function toAgentEvent(raw: unknown): AgentEvent | null {
  if (!isObj(raw)) return null;
  const base = {
    seq: n(raw.seq),
    runId: s(raw.runId),
    requestId: s(raw.requestId),
    step: n(raw.step, 1),
  };
  switch (raw.type) {
    case 'hello':
      return { type: 'hello', ...base, protocol: s(raw.protocol), maxSteps: n(raw.maxSteps, 60), maxCallsPerStep: n(raw.maxCallsPerStep, 6) };
    case 'engine':
      return { type: 'engine', ...base, engine: s(raw.engine), label: s(raw.label), model: s(raw.model), web: raw.web === true };
    case 'status':
      return { type: 'status', ...base, status: s(raw.status) };
    case 'assistant_delta':
      return { type: 'assistant_delta', ...base, text: s(raw.text) };
    case 'tool_call': {
      const name = s(raw.name);
      const id = s(raw.id);
      if (!name || !id) return null;
      return { type: 'tool_call', ...base, id, name, arguments: isObj(raw.arguments) ? raw.arguments : {} };
    }
    case 'usage':
      return { type: 'usage', ...base, inputTokens: n(raw.inputTokens), outputTokens: n(raw.outputTokens) };
    case 'warning':
      return { type: 'warning', ...base, code: s(raw.code, 'warning'), message: s(raw.message) };
    case 'error':
      return { type: 'error', ...base, code: s(raw.code, 'error'), message: s(raw.message), recoverable: raw.recoverable === true };
    case 'done': {
      const reason = raw.reason === 'tool_calls' || raw.reason === 'final' || raw.reason === 'empty' ? raw.reason : 'final';
      return { type: 'done', ...base, reason, toolCalls: n(raw.toolCalls) };
    }
    default:
      return null;
  }
}

/** Events emitted by `--json` mode. Versioned separately from the wire. */
export const JSON_SCHEMA_VERSION = 'vinax-cli-json/1';
