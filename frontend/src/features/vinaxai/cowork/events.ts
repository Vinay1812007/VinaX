/**
 * VinaX AI Cowork — a task's Managed Agents events folded into what the page
 * shows: the person's messages, Claude's messages (live while it writes:
 * `event_start` / `event_delta` previews, replaced by the buffered
 * `agent.message`), each tool call with its result, approvals waiting on the
 * person, notes, and the task's status and spend. Pure, so history and the
 * live stream go through the same code; events with an id are applied once.
 */

export interface CoworkEvent {
  type: string;
  id?: string;
  processed_at?: string | null;
  [key: string]: unknown;
}

export type Item =
  | { kind: 'user'; id: string; text: string; queued: boolean }
  | { kind: 'text'; id: string; text: string; live: boolean }
  | {
    kind: 'tool'; id: string; name: string; input: Record<string, unknown>;
    /** allow: ran (or will); ask: waits on the person; deny: refused by the server's check. */
    permission: 'allow' | 'ask' | 'deny';
    decided: 'allow' | 'deny' | null;
    result: { text: string; isError: boolean } | null;
  }
  | { kind: 'note'; id: string; text: string; tone: 'info' | 'error' };

export type TaskStatus = 'idle' | 'running' | 'rescheduling' | 'terminated' | 'unknown';

export interface TaskState {
  items: Item[];
  seen: ReadonlySet<string>;
  status: TaskStatus;
  /** Why it went idle: end_turn, requires_action, budget_reached, retries_exhausted. */
  stopReason: string | null;
  /** A model request is in flight (Claude is thinking or writing). */
  working: boolean;
  costCents: number | null;
  budgetCents: number | null;
}

export const emptyTask = (): TaskState => ({ items: [], seen: new Set(), status: 'unknown', stopReason: null, working: false, costCents: null, budgetCents: null });

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => {
    const o = b as { type?: unknown; text?: unknown; content?: unknown };
    if (typeof o?.text === 'string') return o.text;
    if (o?.type === 'tool_result' || Array.isArray(o?.content)) return textOf(o.content);
    return '';
  }).filter(Boolean).join('\n');
};

const cents = (v: unknown): number | null => {
  const n = Number((v as { amount?: unknown } | null)?.amount);
  return Number.isFinite(n) ? n : null;
};

/** Optimistic message ids start with this (replaced when the server echoes the message). */
export const LOCAL = 'local-';

function replaceItem(items: Item[], id: string, next: (it: Item) => Item): Item[] {
  const i = items.findIndex((it) => it.id === id);
  if (i < 0) return items;
  const out = items.slice();
  out[i] = next(items[i]);
  return out;
}

/** One event in, the next state out (the same state when it changes nothing). */
export function applyEvent(s: TaskState, ev: CoworkEvent): TaskState {
  const id = typeof ev.id === 'string' && ev.id ? ev.id : null;
  // A queued user event comes twice (processed_at null, then set): the second one updates, it is not new.
  const repeat = id ? s.seen.has(id) : false;
  if (repeat && ev.type !== 'user.message') return s;
  const seen = id && !repeat ? new Set(s.seen).add(id) : s.seen;
  const next = (patch: Partial<TaskState>): TaskState => ({ ...s, seen, ...patch });

  switch (ev.type) {
    case 'user.message': {
      const text = textOf(ev.content);
      const queued = ev.processed_at == null;
      if (repeat) return next({ items: replaceItem(s.items, id!, (it) => (it.kind === 'user' ? { ...it, queued } : it)) });
      // The page's own optimistic copy, matched by text.
      const local = s.items.findIndex((it) => it.kind === 'user' && it.id.startsWith(LOCAL) && it.text.trim() === text.trim());
      const item: Item = { kind: 'user', id: id ?? `${LOCAL}echo-${s.items.length}`, text, queued };
      if (local >= 0) {
        const items = s.items.slice();
        items[local] = item;
        return next({ items });
      }
      return next({ items: [...s.items, item] });
    }
    case 'event_start': {
      const target = ev.event as { type?: unknown; id?: unknown } | undefined;
      if (target?.type !== 'agent.message' || typeof target.id !== 'string') return s;
      if (s.items.some((it) => it.id === target.id)) return s;
      return next({ items: [...s.items, { kind: 'text', id: target.id, text: '', live: true }], working: true });
    }
    case 'event_delta': {
      const target = typeof ev.event_id === 'string' ? ev.event_id : null;
      const piece = (ev.delta as { content?: { text?: unknown } } | undefined)?.content?.text;
      if (!target || typeof piece !== 'string') return s;
      return next({ items: replaceItem(s.items, target, (it) => (it.kind === 'text' && it.live ? { ...it, text: it.text + piece } : it)) });
    }
    case 'agent.message': {
      const text = textOf(ev.content);
      if (id && s.items.some((it) => it.id === id)) return next({ items: replaceItem(s.items, id, () => ({ kind: 'text', id, text, live: false })) });
      if (!text.trim()) return next({});
      return next({ items: [...s.items, { kind: 'text', id: id ?? `msg-${s.items.length}`, text, live: false }] });
    }
    case 'agent.tool_use':
    case 'agent.mcp_tool_use': {
      const p = ev.evaluated_permission;
      const permission = p === 'ask' || p === 'deny' ? p : 'allow';
      const name = typeof ev.name === 'string' ? ev.name : typeof ev.tool_name === 'string' ? ev.tool_name : 'tool';
      const input = ev.input && typeof ev.input === 'object' ? (ev.input as Record<string, unknown>) : {};
      return next({ items: [...s.items, { kind: 'tool', id: id ?? `tool-${s.items.length}`, name, input, permission, decided: null, result: null }] });
    }
    case 'agent.tool_result':
    case 'agent.mcp_tool_result': {
      const ref = [ev.tool_use_id, ev.mcp_tool_use_id].find((v): v is string => typeof v === 'string');
      let at = ref ? s.items.findIndex((it) => it.kind === 'tool' && it.id === ref) : -1;
      // No reference (or an unknown one): the latest call still without a result.
      if (at < 0) for (let i = s.items.length - 1; i >= 0; i--) { const it = s.items[i]; if (it.kind === 'tool' && !it.result) { at = i; break; } }
      if (at < 0) return next({});
      const items = s.items.slice();
      const tool = items[at] as Extract<Item, { kind: 'tool' }>;
      items[at] = { ...tool, result: { text: textOf(ev.content), isError: ev.is_error === true } };
      return next({ items });
    }
    case 'user.tool_confirmation': {
      const ref = typeof ev.tool_use_id === 'string' ? ev.tool_use_id : null;
      const decided = ev.result === 'allow' ? 'allow' : 'deny';
      return ref ? next({ items: replaceItem(s.items, ref, (it) => (it.kind === 'tool' ? { ...it, decided } : it)) }) : next({});
    }
    case 'span.model_request_start':
    case 'agent.thinking':
      return next({ working: true });
    case 'span.model_request_end':
      // An interrupted or failed request leaves its preview unreconciled: it stops being live.
      return next({ working: false, items: s.items.map((it) => (it.kind === 'text' && it.live ? { ...it, live: false } : it)) });
    case 'session.status_running':
      return next({ status: 'running', stopReason: null });
    case 'session.status_rescheduled':
      return next({ status: 'rescheduling' });
    case 'session.status_idle': {
      const reason = (ev.stop_reason as { type?: unknown } | undefined)?.type;
      return next({ status: 'idle', stopReason: typeof reason === 'string' ? reason : 'end_turn', working: false, items: s.items.map((it) => (it.kind === 'text' && it.live ? { ...it, live: false } : it)) });
    }
    case 'session.status_terminated':
      return next({ status: 'terminated', working: false });
    case 'session.usage': {
      const budget = cents((ev.budget as { max_list_cost?: unknown } | undefined)?.max_list_cost);
      return next({ costCents: cents(ev.list_cost) ?? s.costCents, budgetCents: budget ?? s.budgetCents });
    }
    case 'session.updated': {
      if (!('budget' in ev)) return next({});
      return next({ budgetCents: ev.budget === null ? null : cents((ev.budget as { max_list_cost?: unknown }).max_list_cost) });
    }
    case 'session.error': {
      const err = ev.error as { message?: unknown } | undefined;
      const message = typeof err?.message === 'string' ? err.message : typeof ev.message === 'string' ? ev.message : 'Something went wrong in the task.';
      return next({ items: [...s.items, { kind: 'note', id: id ?? `err-${s.items.length}`, text: message, tone: 'error' }] });
    }
    case 'agent.thread_context_compacted':
      return next({ items: [...s.items, { kind: 'note', id: id ?? `compact-${s.items.length}`, text: 'Earlier steps were summarised to make room.', tone: 'info' }] });
    default:
      return id && !repeat ? next({}) : s;
  }
}

export const applyAll = (s: TaskState, events: readonly CoworkEvent[]): TaskState => events.reduce(applyEvent, s);

/** Tool calls waiting for the person's Allow / Deny. */
export const pendingApprovals = (s: TaskState): Array<Extract<Item, { kind: 'tool' }>> =>
  s.items.filter((it): it is Extract<Item, { kind: 'tool' }> => it.kind === 'tool' && it.permission === 'ask' && !it.decided && !it.result);

/**
 * Keep the stream open: the task is working, waiting on a decision, or has
 * no events yet (a new task, about to get its first message).
 */
export const isActive = (s: TaskState): boolean =>
  s.status === 'unknown' || s.status === 'running' || s.status === 'rescheduling' || (s.status === 'idle' && s.stopReason === 'requires_action');

const short = (v: unknown, n = 120): string => {
  const t = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** One line saying what a tool call does, in plain words. */
export function toolLine(name: string, input: Record<string, unknown>): string {
  const path = input.file_path ?? input.path ?? input.filename;
  switch (name) {
    case 'bash': return `Ran ${short(input.command ?? input.cmd, 100) || 'a command'}`;
    case 'read': return `Read ${short(path) || 'a file'}`;
    case 'write': return `Wrote ${short(path) || 'a file'}`;
    case 'edit': return `Edited ${short(path) || 'a file'}`;
    case 'glob': return `Looked for files: ${short(input.pattern)}`;
    case 'grep': return `Searched files for ${short(input.pattern)}`;
    case 'web_search': return `Searched the web: ${short(input.query)}`;
    case 'web_fetch': return `Opened ${short(input.url)}`;
    default: return `Used ${name}${Object.keys(input).length ? `: ${short(input, 80)}` : ''}`;
  }
}

/** The first line of a task, as its title. */
export const titleFrom = (text: string): string => text.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 120) ?? 'New task';
