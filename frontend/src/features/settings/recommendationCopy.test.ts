/**
 * The discovery sentences in Settings state numbers. They must be the
 * numbers the engine uses, so this reads the engine's own table and checks
 * every option against it — a retune of the engine fails here until the
 * copy says the same thing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISCOVERY_OPTIONS, QUEUE_LANGUAGE_OPTIONS, intensityWords } from './recommendationCopy';

const engine = readFileSync(resolve(__dirname, '../../services/recommendation/engine.ts'), 'utf8');
const table = engine.match(/const DISCOVERY_SHARE = \{([^}]*)\}/)?.[1] ?? '';
const engineShare = (mode: string): number => Number(table.match(new RegExp(`${mode}:\\s*([0-9.]+)`))?.[1]);

describe('Settings recommendation copy', () => {
  it('finds the engine’s discovery table', () => {
    expect(table).not.toBe('');
  });

  it.each(DISCOVERY_OPTIONS.map((o) => [o.value, o] as const))('%s states the share the engine uses', (mode, option) => {
    expect(option.share).toBe(engineShare(mode));
    expect(option.line).toContain(`${Math.round(option.share * 100)}%`);
  });

  it('offers the three modes in order, each with one sentence', () => {
    expect(DISCOVERY_OPTIONS.map((o) => o.label)).toEqual(['Familiar', 'Balanced', 'Discover']);
    for (const o of DISCOVERY_OPTIONS) expect(o.line.split(/[.!?](\s|$)/).filter((s) => s.trim()).length).toBe(1);
  });

  it('names both queue-language choices', () => {
    expect(QUEUE_LANGUAGE_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ['mix', 'Your languages'],
      ['one', 'One language'],
    ]);
  });

  it('describes the trending slider at both ends and in the middle', () => {
    expect(intensityWords(0)).toMatch(/popular and trending/);
    expect(intensityWords(0.5)).toMatch(/mix/);
    expect(intensityWords(1)).toMatch(/your own listening/);
  });
});
