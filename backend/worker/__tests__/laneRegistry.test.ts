/**
 * Lane <-> key <-> registry integrity. A key change renames secrets at once,
 * and the failure mode of that kind of change is silent: a lane keeps
 * pointing at a name Cloudflare no longer has, its key reads undefined, and
 * the feature quietly degrades through the ladder forever. These checks fail
 * the build instead.
 *
 * 10.3 — exactly four AI key secrets, one per provider; every lane signs with
 * one of them, and no per-model secret name survives anywhere in backend/.
 * Their primary names are NVIDIA_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY and
 * GEMINI_API_KEY; each falls back to its previous name while unset.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AI_KEY_FALLBACKS,
  AI_KEY_SECRETS,
  AI_PROVIDERS,
  KEY_PROVIDERS,
  PROVIDER_ENV_FALLBACK,
  providerKey,
  providerKeySource,
  LANE_BASE,
  LANE_ENV,
  LANE_MODEL,
  LANE_PROVIDER,
  LANE_SECONDARY,
  PROVIDER_ENV,
  PROVIDER_LANE,
  laneAttempts,
  type KeyLane,
} from '../functions/_lib/ai';
import { AI_MODEL_REGISTRY, registryEnvKeys } from '../functions/_lib/models';
import { ENV_ITEMS } from '../functions/api/admin/envcheck';

const lanes = Object.keys(LANE_ENV) as KeyLane[];
const registrySlugs = new Set(Object.values(AI_MODEL_REGISTRY).map((m) => m.id));
const registryEnv = new Set(registryEnvKeys());
const FOUR = ['NVIDIA_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY'];
const PREVIOUS = ['VINAX_NVIDIA_API_KEY', 'VINAX_OPENROUTER_API_KEY', 'VINAX_GROQ_API_KEY', 'VINAX_GGL_GEMINI_API_KEY'];

describe('10.3 — one key per provider', () => {
  it('reads exactly four AI key secrets, one per provider, in menu order', () => {
    expect([...AI_KEY_SECRETS]).toEqual(FOUR);
    expect([...KEY_PROVIDERS]).toEqual(['nvidia', 'openrouter', 'groq', 'gemini']);
    // 11.2 — the fifth provider (Workers AI) has no key: it runs on the AI binding.
    expect([...AI_PROVIDERS]).toEqual(['nvidia', 'openrouter', 'groq', 'gemini', 'cloudflare']);
    expect(new Set(Object.values(PROVIDER_ENV)).size).toBe(4);
    expect([...AI_KEY_FALLBACKS]).toEqual(PREVIOUS);
  });

  it('each provider reads its primary name, else its previous name — through providerKey only', () => {
    for (const [i, p] of KEY_PROVIDERS.entries()) {
      expect(PROVIDER_ENV[p]).toBe(FOUR[i]);
      expect(PROVIDER_ENV_FALLBACK[p]).toBe(PREVIOUS[i]);
      expect(providerKey({}, p)).toBeNull();
      expect(providerKey({ [PREVIOUS[i]]: ' old\n' }, p)).toBe('old');
      expect(providerKeySource({ [PREVIOUS[i]]: 'old' }, p)).toEqual({ name: PREVIOUS[i], fallback: true });
      expect(providerKey({ [FOUR[i]]: 'new', [PREVIOUS[i]]: 'old' }, p)).toBe('new');
      expect(providerKeySource({ [FOUR[i]]: 'new', [PREVIOUS[i]]: 'old' }, p)).toEqual({ name: FOUR[i], fallback: false });
      // A blank primary does not hide a set fallback.
      expect(providerKey({ [FOUR[i]]: '  ', [PREVIOUS[i]]: 'old' }, p)).toBe('old');
    }
    expect(laneAttempts({ NVIDIA_API_KEY: 'new-nv' }, 'chat')[0].key).toBe('new-nv');
    expect(laneAttempts({ VINAX_GGL_GEMINI_API_KEY: 'old-gm' }, 'maestro')[0].key).toBe('old-gm');
  });

  it('no code reads an AI key except through providerKey', () => {
    const root = join(__dirname, '..', 'functions');
    const offenders: string[] = [];
    for (const f of backendFiles(root)) {
      if (f.endsWith('.test.ts') || f.endsWith(join('_lib', 'ai.ts'))) continue;
      const text = readFileSync(f, 'utf8');
      if (/env\.(?:VINAX_)?(?:NVIDIA|OPENROUTER|GROQ|GGL_GEMINI|GEMINI)_API_KEY|env\[(?:PROVIDER_ENV|LANE_ENV|PROVIDER_ENV_FALLBACK)\b/.test(text)) offenders.push(f.slice(root.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it('every lane signs with one of the four, through its provider', () => {
    for (const lane of lanes) {
      expect(FOUR, `${lane} signs with ${LANE_ENV[lane]}`).toContain(LANE_ENV[lane]);
      expect(LANE_ENV[lane]).toBe(PROVIDER_ENV[LANE_PROVIDER[lane] as keyof typeof PROVIDER_ENV]);
    }
  });

  it('keeps the feature lanes, and the agent and bench lanes are gone', () => {
    expect(lanes.sort()).toEqual(['chat', 'deep', 'dj', 'fast', 'home', 'maestro', 'mini', 'pro', 'router', 'scholar', 'search', 'vision', 'vision90']);
    // 11.2 — the Workers AI lane signs with no key, so LANE_ENV leaves it out.
    expect(Object.keys(LANE_PROVIDER)).toContain('workers');
    expect(LANE_PROVIDER.workers).toBe('cloudflare');
    for (const gone of ['agent', 'dsflash', 'muse', 'rank', 'laguna', 'diffusion', 'gemma4']) expect(lanes).not.toContain(gone);
  });

  it('maps the providers to their lanes and hosts', () => {
    expect(LANE_PROVIDER.scholar).toBe('groq');
    expect(LANE_PROVIDER.router).toBe('openrouter');
    expect(LANE_PROVIDER.maestro).toBe('gemini');
    for (const lane of lanes) if (!LANE_BASE[lane]) expect(LANE_PROVIDER[lane], `${lane} rides the NVIDIA base`).toBe('nvidia');
    for (const p of AI_PROVIDERS) expect(LANE_PROVIDER[PROVIDER_LANE[p]]).toBe(p);
  });

  it('one NVIDIA key opens every NVIDIA lane — and the same request is never walked twice', () => {
    const attempts = laneAttempts({ VINAX_NVIDIA_API_KEY: 'nv' }, 'chat');
    expect(attempts.length).toBeGreaterThan(4);
    expect(new Set(attempts.map((a) => a.key))).toEqual(new Set(['nv']));
    const calls = attempts.map((a) => `${a.endpoint}|${a.model}`);
    expect(new Set(calls).size).toBe(calls.length);
  });

  it('the env checklist lists the four keys and no other AI key', () => {
    const ai = ENV_ITEMS.filter((i) => i.group === 'AI').map((i) => i.name);
    for (const name of FOUR) expect(ai).toContain(name);
    expect(ENV_ITEMS.filter((i) => i.fallback).map((i) => i.fallback)).toEqual(PREVIOUS);
    expect(ai.filter((n) => /^VINAX_.*(KEY|_IT|_INT|_A3B|_B)$/.test(n) && !FOUR.includes(n))).toEqual([]);
  });
});

describe('lane wiring', () => {
  it('gives every lane both a key and a pinned model', () => {
    for (const lane of lanes) {
      expect(LANE_ENV[lane], `${lane} has no env key`).toBeTruthy();
      expect(LANE_MODEL[lane], `${lane} has no pinned model`).toBeTruthy();
    }
  });

  it('the registry names only the four keys, and every one of them', () => {
    expect([...registryEnv].sort()).toEqual([...FOUR].sort());
  });

  it('pins only model slugs the registry describes', () => {
    for (const lane of lanes) {
      // The marketplace lane's pin is a default the listener overrides from a
      // live catalog, so it is checked against the registry row, not the set.
      if (LANE_BASE[lane]) continue;
      expect(registrySlugs.has(LANE_MODEL[lane]), `${lane} pins ${LANE_MODEL[lane]}, absent from the registry`).toBe(true);
    }
  });

  it('never points a secondary at the primary it is meant to rescue', () => {
    for (const lane of lanes) {
      const second = LANE_SECONDARY[lane];
      if (second) expect(second, `${lane} secondary duplicates its primary`).not.toBe(LANE_MODEL[lane]);
    }
  });

  it('keeps the retired engines out of the wiring entirely', () => {
    // gpt-oss-120b is deliberately NOT here: it was retired on the default
    // base but is on the scholar key's current working list, where it is the
    // same-key secondary. A slug is only "retired" per provider.
    const retired = ['minimax', 'nemotron-3-nano-30b-a3b', 'ising-calibration-1-35b', 'nemotron-super-49b'];
    const wiring = JSON.stringify({ LANE_MODEL, LANE_SECONDARY, LANE_ENV });
    for (const slug of retired) expect(wiring, `${slug} is still wired`).not.toContain(slug);
    // The two slugs the provider retired under us, which took both catalog
    // lanes down with a 404. They must never come back as a fixed pin.
    for (const dead of ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'])
      expect(wiring, `${dead} was retired upstream and must not be pinned`).not.toContain(dead);
  });
});

/** Every code, config and env-template file under backend/ — the places a secret name is read or documented. */
function backendFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.wrangler') || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) backendFiles(full, acc);
    else if (/\.(ts|toml|example)$/.test(name)) acc.push(full);
  }
  return acc;
}

describe('10.3 — no removed secret name remains in backend/', () => {
  const root = join(__dirname, '..', '..');
  const files = backendFiles(root).concat([join(root, '.env.example')]);
  // The per-model names of the 2026-09-09 generation, by their family prefixes.
  const REMOVED = /VINAX_(NVD|OAI|DEEPSEEK|MISTRAL|KIMI|MTA|POOLSIDE)_[A-Z0-9_]+|VINAX_GGL_(DIFF|GEMMA)[A-Z0-9_]*/;
  const self = __filename;

  it('scans the tree at all (guards against a bad walk silently passing)', () => {
    expect(files.some((f) => f.endsWith('ai.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('wrangler.toml'))).toBe(true);
    expect(files.some((f) => f.endsWith('.env.example'))).toBe(true);
  });

  it('finds none of the per-model AI secret names', () => {
    const hits: string[] = [];
    for (const f of files) {
      if (f === self) continue;
      const text = readFileSync(f, 'utf8');
      const m = REMOVED.exec(text);
      if (m) hits.push(`${f.slice(root.length + 1)}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });
});
