/**
 * The permission policy: what each mode allows without asking, and what
 * nothing allows without asking.
 */
import { describe, expect, it } from 'vitest';
import { autoAllowed, PermissionEngine, type ActionRequest } from '../src/permissions/policy.js';

const req = (over: Partial<ActionRequest> = {}): ActionRequest => ({
  kind: 'write',
  title: 'Modify src/a.ts?',
  detail: [],
  risk: 'routine',
  scopeKey: 'edit:project',
  scopeLabel: 'Allow project edits this session',
  ...over,
});

describe('what each mode allows without asking', () => {
  it('ask: reads run freely, everything else is confirmed', () => {
    expect(autoAllowed('ask', 'read', 'routine')).toBe(true);
    for (const kind of ['write', 'delete', 'execute', 'shell', 'git-write', 'remote-write', 'network', 'mcp'] as const) {
      expect(autoAllowed('ask', kind, 'routine'), kind).toBe(false);
    }
  });

  it('auto-edit: project edits and routine commands run; remote writes and installs do not', () => {
    expect(autoAllowed('auto-edit', 'write', 'routine')).toBe(true);
    expect(autoAllowed('auto-edit', 'delete', 'routine')).toBe(true);
    expect(autoAllowed('auto-edit', 'git-write', 'routine')).toBe(true);
    expect(autoAllowed('auto-edit', 'execute', 'routine')).toBe(true);
    expect(autoAllowed('auto-edit', 'execute', 'elevated')).toBe(false);
    expect(autoAllowed('auto-edit', 'remote-write', 'elevated')).toBe(false);
    expect(autoAllowed('auto-edit', 'network', 'elevated')).toBe(false);
  });

  it('full-auto: routine project work runs, including installs', () => {
    expect(autoAllowed('full-auto', 'write', 'routine')).toBe(true);
    expect(autoAllowed('full-auto', 'execute', 'elevated')).toBe(true);
    expect(autoAllowed('full-auto', 'delete', 'elevated')).toBe(true);
  });

  it('full-auto is NOT root: critical actions ask in every mode', () => {
    for (const mode of ['ask', 'auto-edit', 'full-auto'] as const) {
      for (const kind of ['write', 'delete', 'execute', 'shell', 'git-write', 'network'] as const) {
        expect(autoAllowed(mode, kind, 'critical'), `${mode}/${kind}`).toBe(false);
      }
    }
  });

  it('anything outside the workspace asks in every mode', () => {
    for (const mode of ['ask', 'auto-edit', 'full-auto'] as const) {
      expect(autoAllowed(mode, 'outside-workspace', 'routine'), mode).toBe(false);
    }
  });

  it('credential files ask in every mode', () => {
    for (const mode of ['ask', 'auto-edit', 'full-auto'] as const) {
      expect(autoAllowed(mode, 'protected-read', 'routine'), mode).toBe(false);
    }
  });

  it('remote repository writes ask in every mode, including full-auto', () => {
    for (const mode of ['ask', 'auto-edit', 'full-auto'] as const) {
      expect(autoAllowed(mode, 'remote-write', 'elevated'), mode).toBe(false);
    }
  });

  it('an external MCP tool is never routine, even in full-auto', () => {
    expect(autoAllowed('full-auto', 'mcp', 'elevated')).toBe(false);
  });
});

describe('the engine', () => {
  it('asks, then remembers a session grant for that scope only', async () => {
    const asked: ActionRequest[] = [];
    const engine = new PermissionEngine({ mode: 'ask' });
    engine.setPrompter(async (r) => { asked.push(r); return 'session'; });

    expect((await engine.check(req())).outcome).toBe('allow');
    expect((await engine.check(req())).outcome).toBe('allow');
    expect(asked).toHaveLength(1);

    // A different scope is a different question.
    await engine.check(req({ kind: 'execute', scopeKey: 'run:npm', title: 'Run command?' }));
    expect(asked).toHaveLength(2);
  });

  it('does not remember a one-time allow', async () => {
    let asks = 0;
    const engine = new PermissionEngine({ mode: 'ask' });
    engine.setPrompter(async () => { asks += 1; return 'once'; });
    await engine.check(req());
    await engine.check(req());
    expect(asks).toBe(2);
  });

  it('denies when the user rejects, and says so', async () => {
    const engine = new PermissionEngine({ mode: 'ask' });
    engine.setPrompter(async () => 'reject');
    const d = await engine.check(req());
    expect(d.outcome).toBe('deny');
    if (d.outcome === 'deny') expect(d.reason).toBe('user');
  });

  it('NEVER blocks in a non-interactive run — it refuses with a reason', async () => {
    const engine = new PermissionEngine({ mode: 'ask' });
    expect(engine.interactive).toBe(false);
    const d = await engine.check(req());
    expect(d.outcome).toBe('deny');
    if (d.outcome === 'deny') {
      expect(d.reason).toBe('non-interactive');
      expect(d.message).toContain('cannot ask');
    }
  });

  it('honours a grant given up front, so a scripted run can be pre-authorised', async () => {
    const engine = new PermissionEngine({ mode: 'ask', grants: ['edit:project'] });
    expect((await engine.check(req())).outcome).toBe('allow');
  });

  it('records every decision for the session log', async () => {
    const engine = new PermissionEngine({ mode: 'full-auto' });
    await engine.check(req());
    await engine.check(req({ kind: 'read', risk: 'routine' }));
    expect(engine.log).toHaveLength(2);
    expect(engine.log.every((e) => e.decision.outcome === 'allow')).toBe(true);
  });

  it('can be tightened mid-session', async () => {
    const engine = new PermissionEngine({ mode: 'full-auto' });
    expect((await engine.check(req())).outcome).toBe('allow');
    engine.setMode('ask');
    const d = await engine.check(req({ scopeKey: 'edit:other' }));
    expect(d.outcome).toBe('deny');
  });

  it('notifies an observer of each decision', async () => {
    const seen: string[] = [];
    const engine = new PermissionEngine({
      mode: 'full-auto',
      onDecision: (r, d) => seen.push(`${r.kind}:${d.outcome}`),
    });
    await engine.check(req());
    expect(seen).toEqual(['write:allow']);
  });
});
