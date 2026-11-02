/**
 * VinaX AI — the owner's instructions and limits in the `vinax-ai` setting:
 * sanitising (clamped, defaults), the instructions block in the system prompt
 * (after VinaX AI's own rules, before the artifacts), the limits the models
 * route reports to the page, and the owner's searches-per-day cap.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, LIMIT_RANGES, MAX_OWNER_INSTRUCTIONS, sanitizeAiSettings, sanitizeLimits } from '../functions/_lib/ai/config';
import { ARTIFACTS_BLOCK, buildSystemPrompt, ownerBlock, type PromptVars } from '../functions/_lib/ai/prompt';
import { MODELS, modelById } from '../functions/_lib/ai/models';
import { dailyLimit, searchConfigured } from '../functions/_lib/ai/search';
import { onRequestGet as getModels } from '../functions/api/ai/models';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', GROQ_API_KEY: 'gsk-test', ...DB_ENV };
const vars: PromptVars = { now: new Date(Date.UTC(2026, 10, 2, 9, 0)), timezone: 'Asia/Kolkata', locale: 'en-IN', firstName: 'Asha', modelName: 'GPT-OSS 120B', providerName: 'Groq' };
const full = modelById(MODELS, 'groq:openai/gpt-oss-120b')!;

beforeEach(() => {
  resetSettingsMemo();
  _resetRateLimitsForTests();
});

describe('the owner’s settings', () => {
  it('defaults: no instructions, the raised limits, and the Worker’s search cap', () => {
    const s = sanitizeAiSettings({ enabled: true });
    expect(s.instructions).toBe('');
    expect(s.limits).toEqual({ messagesPerMinute: 20, imagesPerMessage: 10, filesPerMessage: 20, filesPerChat: 50, pdfMB: 30, pdfPages: 500, textMB: 2, searchesPerDay: null });
    expect(DEFAULT_LIMITS.filesPerChat).toBe(LIMIT_RANGES.filesPerChat[2]);
  });

  it('clamps every limit to its range and ignores junk', () => {
    expect(sanitizeLimits({ messagesPerMinute: 500, pdfMB: 0, pdfPages: '250', textMB: 'lots', filesPerChat: -3, searchesPerDay: 99_999 })).toMatchObject({
      messagesPerMinute: 30, pdfMB: 1, pdfPages: 250, textMB: 2, filesPerChat: 1, searchesPerDay: 2_000,
    });
    expect(sanitizeLimits({ searchesPerDay: 0 }).searchesPerDay).toBe(0);
    expect(sanitizeLimits({ searchesPerDay: '' }).searchesPerDay).toBeNull();
    expect(sanitizeLimits('nope')).toEqual(DEFAULT_LIMITS);
  });

  it('cleans the instructions: control characters out, trimmed, capped', () => {
    expect(sanitizeAiSettings({ instructions: '  Be kind.\u0007\n\n\n\nUse short paragraphs.  ' }).instructions).toBe('Be kind. \n\nUse short paragraphs.');
    expect(sanitizeAiSettings({ instructions: 'x'.repeat(10_000) }).instructions).toHaveLength(MAX_OWNER_INSTRUCTIONS);
    expect(sanitizeAiSettings({ instructions: 42 }).instructions).toBe('');
  });
});

describe('the owner’s instructions in the system prompt', () => {
  it('come right after VinaX AI’s own prompt, marked as the owner’s, and before the artifacts', () => {
    const p = buildSystemPrompt({ spec: full, vars, artifacts: true, owner: 'Always mention VinaX Radio when it fits.' });
    expect(p).toContain('<owner_instructions>\nAlways mention VinaX Radio when it fits.\n</owner_instructions>');
    expect(p).toMatch(/don't override the rules about what you won't help with/);
    expect(p.indexOf('# Things you won')).toBeLessThan(p.indexOf('<owner_instructions>'));
    expect(p.indexOf('<owner_instructions>')).toBeLessThan(p.indexOf(ARTIFACTS_BLOCK.slice(0, 20)));
  });

  it('add nothing when empty', () => {
    expect(ownerBlock('')).toBeNull();
    expect(ownerBlock('   ')).toBeNull();
    expect(buildSystemPrompt({ spec: full, vars, artifacts: false, owner: '' })).not.toContain('owner_instructions');
  });
});

describe('limits outside the chat route', () => {
  it('the owner’s searches-per-day cap wins over the Worker variable; 0 turns the search API off', () => {
    const env = { SEARCH_API_KEY: 'k', SEARCH_DAILY_LIMIT: '100' } as never;
    expect(dailyLimit(env)).toBe(100);
    expect(dailyLimit(env, 250)).toBe(250);
    expect(searchConfigured(env, 0)).toBe(false);
    expect(searchConfigured(env, null)).toBe(true);
  });

  it('GET /api/ai/models reports the file limits the page should use', async () => {
    fakeDb({ accounts: [{ id: '1001', name: 'Asha' }], settings: [{ key: 'vinax-ai', value: { enabled: true, limits: { filesPerChat: 12, pdfPages: 40 } }, updated_at: 'x', updated_by: 'owner' }] });
    const token = await issueSession(ENV as never, '1001');
    const res = await getModels({ request: new Request('https://www.vinaxmusic.online/api/ai/models', { headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': '198.51.100.7' } }), env: ENV as never });
    const body = (await res.json()) as { limits: Record<string, number> };
    expect(body.limits).toEqual({ imagesPerMessage: 10, filesPerMessage: 20, filesPerChat: 12, pdfMB: 30, pdfPages: 40, textMB: 2 });
  });
});
