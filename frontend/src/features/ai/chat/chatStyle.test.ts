// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_STYLE_IDS,
  CHAT_STYLE_KEY,
  CHAT_STYLES,
  loadChatStylePref,
  makerFamily,
  parseChatStylePref,
  resolveChatStyle,
  saveChatStylePref,
  styleForChoice,
  styleForFamily,
} from './chatStyle';
import type { Provider } from './types';

const model = (id: string, maker: string | null) => ({ id, name: id, maker, context: 131072, vision: false });
const providers = [
  { id: 'openrouter', models: [model('mystery/aurora-alpha:free', null), model('stealth-model', 'OpenAI')] },
  { id: 'gemini', models: [model('models/flash-latest', null)] },
  { id: 'nvidia', models: [model('acme/tiny-1', null)] },
] as unknown as Provider[];

describe('chat styles', () => {
  beforeEach(() => localStorage.clear());

  it('files real slugs from every provider under their maker family', () => {
    const cases: Array<[string, string | null, 'nvidia' | 'openrouter' | 'groq' | 'gemini', string]> = [
      ['openai/gpt-oss-120b', null, 'groq', 'openai'],
      ['openai/gpt-4o-mini', 'OpenAI', 'openrouter', 'openai'],
      ['o4-mini', null, 'openrouter', 'openai'],
      ['gemini-2.5-flash', null, 'gemini', 'google'],
      ['google/gemma-3-27b-it', 'Google', 'nvidia', 'google'],
      ['anthropic/claude-3.5-haiku', 'Anthropic', 'openrouter', 'anthropic'],
      ['meta-llama/llama-4-scout-17b-16e-instruct', null, 'groq', 'meta'],
      ['llama-3.3-70b-versatile', 'Meta', 'groq', 'meta'],
      ['meta/llama-3.1-405b-instruct', null, 'nvidia', 'meta'],
      ['x-ai/grok-4-fast:free', 'xAI', 'openrouter', 'xai'],
      ['mistralai/mixtral-8x22b-instruct-v0.1', null, 'nvidia', 'mistral'],
      ['nvidia/llama-3.1-nemotron-70b-instruct', 'NVIDIA', 'nvidia', 'nvidia'],
      ['deepseek-r1-distill-llama-70b', null, 'groq', 'deepseek'],
      ['deepseek/deepseek-chat-v3.1:free', 'DeepSeek', 'openrouter', 'deepseek'],
      ['qwen/qwen3-32b', 'Alibaba Cloud', 'groq', 'qwen'],
      ['moonshotai/kimi-k2-instruct', 'Moonshot AI', 'groq', 'moonshot'],
      ['microsoft/phi-4-mini-instruct', 'Microsoft', 'nvidia', 'microsoft'],
    ];
    for (const [slug, maker, provider, family] of cases) expect([slug, makerFamily(slug, maker, provider)]).toEqual([slug, family]);
  });

  it('falls back by provider when the maker is unknown', () => {
    expect(makerFamily('models/flash-latest', null, 'gemini')).toBe('google');
    expect(makerFamily('acme/tiny-1', null, 'nvidia')).toBe('nvidia');
    expect(makerFamily('mystery/aurora-alpha:free', null, 'openrouter')).toBe('other');
    expect(makerFamily('compound-beta', null, 'groq')).toBe('other');
    expect(styleForFamily('other')).toBe('deep');
  });

  it('maps a pick to a style: Auto is the house style, a model follows its maker', () => {
    expect(styleForChoice({ mode: 'auto' }, providers)).toBe('vinax');
    expect(styleForChoice(null)).toBe('vinax');
    expect(styleForChoice({ mode: 'model', provider: 'groq', model: 'openai/gpt-oss-120b' })).toBe('mono');
    expect(styleForChoice({ mode: 'model', provider: 'gemini', model: 'models/flash-latest' }, providers)).toBe('spectrum');
    expect(styleForChoice({ mode: 'model', provider: 'openrouter', model: 'anthropic/claude-3.5-haiku' })).toBe('paper');
    expect(styleForChoice({ mode: 'model', provider: 'groq', model: 'llama-3.3-70b-versatile' })).toBe('loop');
    expect(styleForChoice({ mode: 'model', provider: 'openrouter', model: 'x-ai/grok-4-fast:free' })).toBe('void');
    expect(styleForChoice({ mode: 'model', provider: 'nvidia', model: 'mistralai/mixtral-8x22b-instruct-v0.1' })).toBe('forge');
    expect(styleForChoice({ mode: 'model', provider: 'nvidia', model: 'acme/tiny-1' }, providers)).toBe('circuit');
    expect(styleForChoice({ mode: 'model', provider: 'openrouter', model: 'mystery/aurora-alpha:free' }, providers)).toBe('deep');
    // The catalogue's maker string decides when the slug says nothing.
    expect(styleForChoice({ mode: 'model', provider: 'openrouter', model: 'stealth-model' }, providers)).toBe('mono');
  });

  it('parses and stores the preference; anything unknown means "match"', () => {
    expect(loadChatStylePref()).toBe('match');
    expect(parseChatStylePref('paper')).toBe('paper');
    expect(parseChatStylePref('vinax')).toBe('vinax');
    expect(parseChatStylePref('neon')).toBe('match');
    expect(parseChatStylePref(null)).toBe('match');
    saveChatStylePref('void');
    expect(localStorage.getItem(CHAT_STYLE_KEY)).toBe('void');
    expect(loadChatStylePref()).toBe('void');
    const pick = { mode: 'model', provider: 'groq', model: 'openai/gpt-oss-120b' } as const;
    expect(resolveChatStyle('match', pick)).toBe('mono');
    expect(resolveChatStyle('vinax', pick)).toBe('vinax');
    expect(resolveChatStyle('paper', { mode: 'auto' })).toBe('paper');
  });

  it('every style has a table row and CSS blocks for the chat surface and its sheets', () => {
    const css = readFileSync(resolve(__dirname, '../../../styles/ai-styles.css'), 'utf8');
    expect(CHAT_STYLES.map((s) => s.id)).toEqual([...CHAT_STYLE_IDS]);
    for (const id of CHAT_STYLE_IDS) {
      expect(css).toContain(`.ai-root[data-chat-style='${id}']`);
      expect(css).toContain(`.ai-scope[data-chat-style='${id}']`);
      if (id !== 'vinax') {
        expect(css).toContain(`html.light .ai-root[data-chat-style='${id}']`);
        expect(css).toContain(`html.amoled .ai-scope[data-chat-style='${id}']`);
      }
    }
  });
});

describe('chat style layouts', () => {
  it('gives every style a complete layout, and every layout value a CSS rule', async () => {
    const { CHAT_STYLES, CHAT_LAYOUT_KEYS, layoutAttrName, layoutAttrs } = await import('./chatStyle');
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/styles/ai-styles.css', 'utf8');
    for (const s of CHAT_STYLES) {
      expect(s.audience.length).toBeGreaterThan(0);
      for (const key of CHAT_LAYOUT_KEYS) {
        const value = s.layout[key];
        expect(value, `${s.id}.${key}`).not.toBeUndefined();
        expect(css, `${s.id}: ${key}=${String(value)}`).toContain(`[${layoutAttrName(key)}='${String(value)}']`);
      }
      expect(Object.keys(layoutAttrs(s.id))).toHaveLength(CHAT_LAYOUT_KEYS.length);
      expect(css).toContain(`.ai-root[data-chat-style='${s.id}']`);
      expect(css).toContain(`.ai-scope[data-chat-style='${s.id}']`);
    }
  });

  it('keeps the layouts apart: no two model styles share every structural fact', async () => {
    const { CHAT_STYLES } = await import('./chatStyle');
    const seen = new Set(CHAT_STYLES.map((s) => JSON.stringify(s.layout)));
    expect(seen.size).toBe(CHAT_STYLES.length);
  });
});

describe('11.2 — Workers AI slugs', () => {
  it('reads the maker behind the @cf/ host prefix', () => {
    expect(makerFamily('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Meta', 'cloudflare')).toBe('meta');
    expect(makerFamily('@cf/qwen/qwq-32b', null, 'cloudflare')).toBe('qwen');
    expect(makerFamily('@cf/openai/gpt-oss-120b', null, 'cloudflare')).toBe('openai');
    expect(makerFamily('@hf/acme/unknown', null, 'cloudflare')).toBe('other');
  });
});
