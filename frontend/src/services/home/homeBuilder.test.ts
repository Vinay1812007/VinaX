import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideHomeOrder, resetHomeDecision } from './homeBuilder';

afterEach(() => resetHomeDecision());

describe('decideHomeOrder', () => {
  it('orders once per key and keeps that order', () => {
    const order = vi.fn(() => ['feed', 'quick'] as never);
    expect(decideHomeOrder('1|feed,quick', order)).toEqual(['feed', 'quick']);
    expect(decideHomeOrder('1|feed,quick', () => ['quick'] as never)).toEqual(['feed', 'quick']);
    expect(order).toHaveBeenCalledTimes(1);
  });

  it('orders again for a new generation or after a reset', () => {
    decideHomeOrder('1|a', () => ['feed'] as never);
    expect(decideHomeOrder('2|a', () => ['quick'] as never)).toEqual(['quick']);
    resetHomeDecision();
    expect(decideHomeOrder('2|a', () => ['loved'] as never)).toEqual(['loved']);
  });
});
