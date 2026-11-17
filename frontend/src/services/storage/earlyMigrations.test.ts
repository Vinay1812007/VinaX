// @vitest-environment jsdom
/**
 * The clean-up runs at import time, so every case seeds localStorage, resets
 * the module registry and imports the module fresh.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const run = async (): Promise<void> => {
  vi.resetModules();
  await import('./earlyMigrations');
};

beforeEach(() => localStorage.clear());

describe('earlyMigrations', () => {
  it('no longer moves tarang.* keys (no install can still have them)', async () => {
    localStorage.setItem('tarang.library.v1', 'old');
    await run();
    expect(localStorage.getItem('tarang.library.v1')).toBe('old');
    expect(localStorage.getItem('vinax.library.v1')).toBeNull();
  });
});

describe('1.3 — the AI features left nothing behind', () => {
  it('erases what VinaX AI, AI Playlist and the AI DJ kept, and nothing else', async () => {
    for (const k of ['vinax_ai_chats_v1', 'vinax.aiPrompts', 'vinax.aiReplyStyle', 'vinax.ai.chatStyle', 'vinax.ai.memory.v1', 'vinax.aiplaylist.avoid.v1', 'vinax.dj.surfaced.v1', 'vinax.recommendation.ai-metadata.v3']) localStorage.setItem(k, 'x');
    localStorage.setItem('vinax.settings.v1', 's');
    localStorage.setItem('vinax.airplay.v1', 'kept');
    await run();
    expect(Object.keys(localStorage).sort()).toEqual(['vinax.airplay.v1', 'vinax.settings.v1']);
  });
});
