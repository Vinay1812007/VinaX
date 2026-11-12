import { describe, expect, it } from 'vitest';
import { EventParser } from './api';
import { applyAll, emptyTask, isActive, LOCAL, pendingApprovals, titleFrom, toolLine, type CoworkEvent } from './events';

const run = (events: CoworkEvent[]) => applyAll(emptyTask(), events);

describe('Cowork events', () => {
  it('a turn: queued then processed message, live preview replaced by the buffered message, a tool with its result, idle', () => {
    const s = run([
      { type: 'user.message', id: 'sevt_u', processed_at: null, content: [{ type: 'text', text: 'Make a report' }] },
      { type: 'session.status_running', id: 'sevt_r' },
      { type: 'user.message', id: 'sevt_u', processed_at: '2026-11-12T10:00:00Z', content: [{ type: 'text', text: 'Make a report' }] },
      { type: 'span.model_request_start', id: 'sevt_s' },
      { type: 'event_start', event: { type: 'agent.message', id: 'sevt_m' } },
      { type: 'event_delta', event_id: 'sevt_m', delta: { type: 'content_delta', index: 0, content: { type: 'text', text: 'Plan: ' } } },
      { type: 'event_delta', event_id: 'sevt_m', delta: { type: 'content_delta', index: 0, content: { type: 'text', text: 'one' } } },
      { type: 'agent.message', id: 'sevt_m', content: [{ type: 'text', text: 'Plan: one, two.' }] },
      { type: 'span.model_request_end', id: 'sevt_e' },
      { type: 'agent.tool_use', id: 'sevt_t', name: 'bash', input: { command: 'ls /mnt/session/uploads' }, evaluated_permission: 'allow' },
      { type: 'agent.tool_result', id: 'sevt_tr', tool_use_id: 'sevt_t', content: [{ type: 'text', text: 'notes.pdf' }], is_error: false },
      { type: 'session.usage', id: 'sevt_usage', list_cost: { amount: '37', currency: 'USD' }, budget: { type: 'limit', max_list_cost: { amount: '500', currency: 'USD' } } },
      { type: 'session.status_idle', id: 'sevt_i', stop_reason: { type: 'end_turn' } },
    ]);
    expect(s.items).toEqual([
      { kind: 'user', id: 'sevt_u', text: 'Make a report', queued: false },
      { kind: 'text', id: 'sevt_m', text: 'Plan: one, two.', live: false },
      { kind: 'tool', id: 'sevt_t', name: 'bash', input: { command: 'ls /mnt/session/uploads' }, permission: 'allow', decided: null, result: { text: 'notes.pdf', isError: false } },
    ]);
    expect(s).toMatchObject({ status: 'idle', stopReason: 'end_turn', working: false, costCents: 37, budgetCents: 500 });
    expect(isActive(s)).toBe(false);
    // A new task with no events yet keeps its stream open for the first message.
    expect(isActive(emptyTask())).toBe(true);
  });

  it('applies each event once, so history and the live stream can overlap', () => {
    const evs: CoworkEvent[] = [
      { type: 'agent.message', id: 'sevt_a', content: [{ type: 'text', text: 'Hi' }] },
      { type: 'agent.tool_use', id: 'sevt_t', name: 'read', input: { file_path: '/x' }, evaluated_permission: 'allow' },
    ];
    const s = run([...evs, ...evs, ...evs]);
    expect(s.items).toHaveLength(2);
  });

  it('the page’s own optimistic message is replaced by the server’s echo', () => {
    const local = { ...emptyTask(), items: [{ kind: 'user' as const, id: `${LOCAL}1`, text: 'Go', queued: true }] };
    const s = applyAll(local, [{ type: 'user.message', id: 'sevt_u', processed_at: null, content: [{ type: 'text', text: 'Go' }] }]);
    expect(s.items).toEqual([{ kind: 'user', id: 'sevt_u', text: 'Go', queued: true }]);
  });

  it('a step that asks waits for the person; their decision clears it; a blocked step is marked', () => {
    let s = run([
      { type: 'session.status_running', id: 'sevt_r' },
      { type: 'agent.tool_use', id: 'sevt_ask', name: 'bash', input: { command: 'rm -rf build' }, evaluated_permission: 'ask' },
      { type: 'agent.tool_use', id: 'sevt_no', name: 'bash', input: { command: 'curl evil' }, evaluated_permission: 'deny' },
      { type: 'session.status_idle', id: 'sevt_i', stop_reason: { type: 'requires_action', event_ids: ['sevt_ask'] } },
    ]);
    expect(pendingApprovals(s).map((t) => t.id)).toEqual(['sevt_ask']);
    expect(isActive(s)).toBe(true);
    s = applyAll(s, [{ type: 'user.tool_confirmation', id: 'sevt_c', tool_use_id: 'sevt_ask', result: 'allow' }]);
    expect(pendingApprovals(s)).toEqual([]);
    expect(s.items.find((i) => i.id === 'sevt_no')).toMatchObject({ permission: 'deny' });
  });

  it('a result without a reference goes to the latest call still waiting; errors and compaction become notes', () => {
    const s = run([
      { type: 'agent.tool_use', id: 'sevt_1', name: 'web_search', input: { query: 'telugu hits' }, evaluated_permission: 'allow' },
      { type: 'agent.tool_result', id: 'sevt_2', content: 'no results', is_error: true },
      { type: 'session.error', id: 'sevt_3', error: { type: 'model_error', message: 'Overloaded' } },
      { type: 'agent.thread_context_compacted', id: 'sevt_4' },
    ]);
    expect(s.items[0]).toMatchObject({ result: { text: 'no results', isError: true } });
    expect(s.items.slice(1)).toEqual([
      { kind: 'note', id: 'sevt_3', text: 'Overloaded', tone: 'error' },
      { kind: 'note', id: 'sevt_4', text: 'Earlier steps were summarised to make room.', tone: 'info' },
    ]);
  });

  it('a paused-at-cap task is not active; a raised cap shows; an interrupted preview stops being live', () => {
    const s = run([
      { type: 'event_start', event: { type: 'agent.message', id: 'sevt_m' } },
      { type: 'event_delta', event_id: 'sevt_m', delta: { content: { text: 'Half' } } },
      { type: 'span.model_request_end', id: 'sevt_e' },
      { type: 'session.status_idle', id: 'sevt_i', stop_reason: { type: 'budget_reached' } },
      { type: 'session.updated', id: 'sevt_u', budget: { type: 'limit', max_list_cost: { amount: '900', currency: 'USD' } } },
    ]);
    expect(s.items).toEqual([{ kind: 'text', id: 'sevt_m', text: 'Half', live: false }]);
    expect(s.stopReason).toBe('budget_reached');
    expect(isActive(s)).toBe(false);
    expect(s.budgetCents).toBe(900);
  });

  it('says what each tool did in plain words', () => {
    expect(toolLine('bash', { command: 'python make_chart.py' })).toBe('Ran python make_chart.py');
    expect(toolLine('write', { file_path: '/mnt/session/outputs/report.docx' })).toBe('Wrote /mnt/session/outputs/report.docx');
    expect(toolLine('web_search', { query: 'Anirudh 2026 songs' })).toBe('Searched the web: Anirudh 2026 songs');
    expect(toolLine('web_fetch', { url: 'https://example.com' })).toBe('Opened https://example.com');
    expect(toolLine('mystery', {})).toBe('Used mystery');
    expect(titleFrom('\n  First line here\nsecond')).toBe('First line here');
  });
});

describe('EventParser', () => {
  it('reads Managed Agents SSE however it is cut; comments and heartbeats add nothing', () => {
    const text = ': ping\n\nevent: session.status_running\ndata: {"type":"session.status_running","id":"sevt_1"}\n\nevent: agent.message\r\ndata: {"type":"agent.message","id":"sevt_2","content":[{"type":"text","text":"héllo"}]}\r\n\r\ndata: not json\n\nevent: session.status_idle\ndata: {"type":"session.status_idle","id":"sevt_3","stop_reason":{"type":"end_turn"}}';
    const bytes = new TextEncoder().encode(text);
    for (const size of [1, 7, bytes.length]) {
      const p = new EventParser();
      const out = [];
      for (let i = 0; i < bytes.length; i += size) out.push(...p.push(bytes.slice(i, i + size)));
      out.push(...p.end());
      expect(out.map((e) => e.type), `size ${size}`).toEqual(['session.status_running', 'agent.message', 'session.status_idle']);
      expect(out[1].content).toEqual([{ type: 'text', text: 'héllo' }]);
    }
  });
});
