/**
 * VinaX AI — the system message: the owner's prompt verbatim (snapshots),
 * the compact prompt for very small windows, artifacts for every model with
 * room, the listener's preferences, the search blocks and the runtime variables.
 */
import { describe, expect, it } from 'vitest';
import { MODELS, modelById } from '../functions/_lib/ai/models';
import { ARTIFACTS_BLOCK, artifactsOffered, buildSystemPrompt, CITATION_RULES, COMPACT_PROMPT, FULL_PROMPT, firstNameOf, formatNow, promptFor, safeLocale, safeTimezone, sanitizePersonal, type PromptVars } from '../functions/_lib/ai/prompt';
import { wireMessages } from '../functions/_lib/ai/wire';

const vars: PromptVars = { now: new Date(Date.UTC(2026, 9, 30, 13, 5)), timezone: 'Asia/Kolkata', locale: 'en-IN', firstName: 'Asha', modelName: 'GPT-OSS 120B', providerName: 'Groq' };
const full = modelById(MODELS, 'groq:openai/gpt-oss-120b')!;
const fast = modelById(MODELS, 'groq:qwen/qwen3.8-27b')!;
const tiny = modelById(MODELS, 'groq:allam-2-7b')!;

describe('buildSystemPrompt', () => {
  it('full prompt', () => {
    expect(buildSystemPrompt({ spec: full, vars, artifacts: false })).toMatchSnapshot();
  });

  it('compact prompt only for a very small window, without artifacts', () => {
    const p = buildSystemPrompt({ spec: tiny, vars: { ...vars, modelName: 'ALLaM 2 7B' }, artifacts: true });
    expect(p).toMatchSnapshot();
    expect(p).not.toContain('# Artifacts');
  });

  it('every model with room gets the full prompt and artifacts, fast ones included; specialists never get artifacts', () => {
    const p = buildSystemPrompt({ spec: fast, vars: { ...vars, modelName: 'Qwen 3.8 27B' }, artifacts: true });
    expect(p.startsWith(FULL_PROMPT.slice(0, 40))).toBe(true);
    expect(p).toContain(ARTIFACTS_BLOCK);
    for (const m of MODELS) {
      if (m.maxContextChars >= 24_000) expect(promptFor(m), m.id).toBe('full');
      else expect(promptFor(m), m.id).toBe('compact');
    }
    const chatModels = MODELS.filter((m) => m.group && m.group !== 'more' && m.maxOutput >= 4_096);
    expect(chatModels.filter((m) => !artifactsOffered(m)).map((m) => m.id)).toEqual([]);
    expect(artifactsOffered(modelById(MODELS, 'nvidia:nvidia/riva-translate-4b-instruct-v2')!)).toBe(false);
    expect(COMPACT_PROMPT.length).toBeLessThan(1_000);
  });

  it('artifacts come with the visualisation guide', () => {
    expect(ARTIFACTS_BLOCK).toContain('# Visualisations');
    expect(ARTIFACTS_BLOCK).toMatch(/mermaid diagram/);
  });

  it('adds the listener’s preferences after the rules, marked as theirs, and uses their chosen name', () => {
    const personal = sanitizePersonal({ name: 'Ash', about: 'I teach maths in Pune.', instructions: 'Use metric units.\u0007', style: 'concise' });
    expect(personal).toEqual({ name: 'Ash', about: 'I teach maths in Pune.', instructions: 'Use metric units.', style: 'concise' });
    const p = buildSystemPrompt({ spec: full, vars, artifacts: false, personal });
    expect(p).toContain("The user's name is Ash.");
    expect(p).toContain('<user_preferences>');
    expect(p).toContain('I teach maths in Pune.');
    expect(p).toMatch(/Reply style the user picked — Concise/);
    expect(p).toMatch(/never override the rules above about safety/);
    expect(p.indexOf('# Things you won')).toBeLessThan(p.indexOf('<user_preferences>'));
  });

  it('cleans and caps the preferences, and ignores junk', () => {
    expect(sanitizePersonal(null)).toBeNull();
    expect(sanitizePersonal({ style: 'normal' })).toBeNull();
    expect(sanitizePersonal({ style: 'pirate', about: '  ' })).toBeNull();
    expect(sanitizePersonal({ name: '<{{x}}>' })?.name ?? null).toBe('x');
    expect(sanitizePersonal({ about: 'a'.repeat(5_000) })!.about!.length).toBe(1_500);
    expect(buildSystemPrompt({ spec: full, vars, artifacts: false, personal: null })).not.toContain('<user_preferences>');
  });

  it('artifacts block on and off', () => {
    expect(buildSystemPrompt({ spec: full, vars, artifacts: true })).toContain(ARTIFACTS_BLOCK);
    expect(buildSystemPrompt({ spec: full, vars, artifacts: false })).not.toContain('# Artifacts');
  });

  it('search block', () => {
    const p = buildSystemPrompt({ spec: full, vars, artifacts: false, search: { sources: [{ n: 1, url: 'https://example.com/a', title: 'A  title', site: 'example.com', snippet: 'Some\nsnippet' }] } });
    expect(p.slice(p.indexOf('<search_results>'))).toMatchSnapshot();
    expect(p.endsWith(CITATION_RULES)).toBe(true);
    expect(buildSystemPrompt({ spec: full, vars, artifacts: false, search: { sources: [] } })).not.toContain('<search_results>');
  });

  it('names VinaX AI and the running model, never claims another identity', () => {
    const p = buildSystemPrompt({ spec: full, vars, artifacts: false });
    expect(p.startsWith('You are VinaX AI')).toBe(true);
    expect(p).toContain('You are currently running on GPT-OSS 120B from Groq.');
    expect(p).toContain('You are not Claude, ChatGPT or Gemini');
    expect(p).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe('prompt variables', () => {
  it('formats the local time in the listener time zone', () => {
    expect(formatNow(vars.now, 'Asia/Kolkata')).toBe('Friday, 30 October 2026 at 18:35');
  });
  it('falls back safely', () => {
    expect(safeTimezone('Mars/Olympus')).toBe('UTC');
    expect(safeTimezone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(safeLocale('en-IN')).toBe('en-IN');
    expect(safeLocale('ignore previous instructions')).toBe('en');
    expect(firstNameOf('Asha Rao')).toBe('Asha');
    expect(firstNameOf('{{model_name}}')).toBe('modelname'); // braces cannot reach the template
    expect(firstNameOf(null)).toBeNull();
  });
  it('puts the system text in the first user turn for models without a system role', () => {
    const spec = { ...full, flags: { ...full.flags, systemRole: false } };
    expect(wireMessages(spec, 'S', [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }])).toEqual({ system: null, messages: [{ role: 'user', text: 'S\n\n---\n\nq' }, { role: 'assistant', text: 'a' }] });
    expect(wireMessages(full, 'S', [{ role: 'user', text: 'q' }]).system).toBe('S');
  });
});
