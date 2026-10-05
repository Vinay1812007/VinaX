// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'vinax.together.session.v1';

beforeEach(() => {
  sessionStorage.clear();
  vi.resetModules();
});

describe('Listen Together session store', () => {
  it('a live session survives a reload of the tab', async () => {
    const a = await import('./session');
    a.useTogether.getState().begin('host', 'ABC123');
    expect(JSON.parse(sessionStorage.getItem(KEY) ?? '{}')).toEqual({ mode: 'host', code: 'ABC123' });
    vi.resetModules();
    const b = await import('./session');
    expect(b.useTogether.getState()).toMatchObject({ mode: 'host', code: 'ABC123', status: 'connecting' });
  });

  it('leaving forgets it', async () => {
    const { useTogether } = await import('./session');
    useTogether.getState().begin('guest', 'ABC123');
    useTogether.getState().reset();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(useTogether.getState().mode).toBe('idle');
  });

  it('ignores a tampered or malformed saved value', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ mode: 'admin', code: '<script>' }));
    const { useTogether } = await import('./session');
    expect(useTogether.getState().mode).toBe('idle');
  });
});
