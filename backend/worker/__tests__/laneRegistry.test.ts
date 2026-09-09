/**
 * Lane <-> registry integrity (v5.21.0). The 2026-09-09 key rotation renamed
 * every secret at once, and the failure mode of that kind of change is silent:
 * a lane keeps pointing at a name Cloudflare no longer has, its key reads
 * undefined, and the feature quietly degrades through the ladder forever.
 * These checks fail the build instead.
 */
import { describe, expect, it } from 'vitest';
import { LANE_ENV, LANE_MODEL, LANE_SECONDARY, LANE_BASE, type Lane } from '../functions/_lib/ai';
import { AI_MODEL_REGISTRY, registryEnvKeys } from '../functions/_lib/models';

const lanes = Object.keys(LANE_ENV) as Lane[];
const registrySlugs = new Set(Object.values(AI_MODEL_REGISTRY).map((m) => m.id));
const registryEnv = new Set(registryEnvKeys());

describe('lane wiring', () => {
  it('gives every lane both a key and a pinned model', () => {
    for (const lane of lanes) {
      expect(LANE_ENV[lane], `${lane} has no env key`).toBeTruthy();
      expect(LANE_MODEL[lane], `${lane} has no pinned model`).toBeTruthy();
    }
  });

  it('pins only env names the model registry knows — no orphaned secret', () => {
    for (const lane of lanes) {
      expect(registryEnv.has(LANE_ENV[lane]), `${lane} points at ${LANE_ENV[lane]}, absent from the registry`).toBe(true);
    }
  });

  it('reaches every secret the registry lists — no key left unprobeable', () => {
    const wired = new Set<string>(lanes.map((l) => LANE_ENV[l]));
    for (const name of registryEnv) {
      expect(wired.has(name), `${name} is in the registry but no lane uses it`).toBe(true);
    }
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

  it('keeps the retired engines and secret names out of the wiring entirely', () => {
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
    // Pre-rotation secret names share these fragments and no longer exist.
    for (const name of ['VINAX_CHATGPT_', 'VINAX_NVIDIA_', 'VINAX_NEMOTRON_', 'VINAX_MINIMAX_'])
      expect(wiring, `${name}* is a retired secret name`).not.toContain(name);
  });
});
