import { describe, expect, it } from 'vitest';
import { validHomeConfig } from './homeConfig';

describe('published home layout validation', () => {
  it('accepts partial layouts, disabled shelves and default resets', () => {
    expect(validHomeConfig({ blocks: [{ id: 'personal' }, { id: 'feed', enabled: false }] })).toBe(true);
    expect(validHomeConfig({})).toBe(true);
    expect(validHomeConfig({ blocks: [] })).toBe(true);
  });
  it.each([null, [], { blocks: 'quick' }, { blocks: [null] }, { blocks: [{ id: 'invented' }] }, { blocks: [{ id: 'quick', enabled: 'false' }] }, { blocks: [{ id: 'quick' }, { id: 'quick' }] }])('rejects malformed or ambiguous layouts: %j', (value) => {
    expect(validHomeConfig(value)).toBe(false);
  });
});
