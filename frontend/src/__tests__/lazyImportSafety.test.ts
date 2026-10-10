/**
 * Fire-and-forget lazy loads must never reject into the void.
 *
 * `void import('…').then(…)` is how the app reaches for an optional module
 * after boot: telemetry, the adaptive recommender, the DJ voice, a Capacitor
 * plugin. The promise is deliberately not awaited — nothing is waiting on the
 * result — so a rejection has nowhere to land and becomes an *unhandled*
 * rejection.
 *
 * That happens for real. A stale deploy serves an index that asks for a chunk
 * the new build no longer has (the 8.5.2 Pages asset-404 report), the network
 * drops mid-chunk, or a plugin is missing from a web build. The app then
 * reports its own chunk-load failure through the `unhandledrejection` listener
 * telemetry installs — noise for a module that was optional by design. In the
 * test run the same shape fails CI: a lazy load kicked off by the code under
 * test resolves after the suite ends, and Vitest raises
 * `EnvironmentTeardownError: Cannot load … after the environment was torn
 * down` as an unhandled rejection.
 *
 * So the rule is mechanical and checked here rather than left to review: every
 * `void import(…)` statement in src/ ends in a `.catch(…)`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The `void import(…)` statements in one file, as [line, text] pairs. */
function voidImportStatements(source: string): Array<[number, string]> {
  const found: Array<[number, string]> = [];
  let i = 0;
  while ((i = source.indexOf('void import(', i)) !== -1) {
    // Walk to the `;` that closes the statement, ignoring any nested in the
    // callbacks, so the whole chain is in view — not just its first line.
    let depth = 0;
    let j = i;
    for (; j < source.length; j++) {
      const c = source[j];
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') depth--;
      else if (c === ';' && depth === 0) break;
    }
    found.push([source.slice(0, i).split('\n').length, source.slice(i, j)]);
    i = j + 1;
  }
  return found;
}

describe('fire-and-forget lazy imports', () => {
  it('every `void import(…)` in src/ handles its own rejection', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const file of sourceFiles(SRC)) {
      if (/\.test\.tsx?$/.test(file)) continue;
      for (const [line, statement] of voidImportStatements(readFileSync(file, 'utf8'))) {
        checked++;
        if (!statement.includes('.catch(')) offenders.push(`${relative(SRC, file)}:${line}`);
      }
    }
    // Guards the guard: if the walker stops matching, this test must fail
    // loudly rather than quietly pass over an empty list.
    expect(checked).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});
