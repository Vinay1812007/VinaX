import { describe, expect, it } from 'vitest';
import { isNativeMenuZone } from './nativeMenuZone';

describe('isNativeMenuZone', () => {
  it('is every VinaX AI page, shared chats included, and nothing else', () => {
    for (const p of ['/vinaxai', '/vinaxai/', '/vinaxai/c/abc', '/vinaxai/projects', '/vinaxai/artifacts', '/vinaxai/share/Qm9vazEyMzQ1Njc4OTAxMg', '/VinaXAI']) expect(isNativeMenuZone(p), p).toBe(true);
    for (const p of ['/', '/library', '/search/vinaxai', '/vinaxaiplus', '/ai/shared/x']) expect(isNativeMenuZone(p), p).toBe(false);
  });
});
