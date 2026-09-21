import { describe, expect, it } from 'vitest';
import { canonKey } from '../functions/api/dj';

/**
 * Review probe 3 (2026-09-19): the Worker's canonical identity stripped
 * combining marks, so Indic vowel signs vanished and different songs
 * collapsed onto one key. The contract is shared with the app.
 */
describe('canonKey — a Unicode-safe song identity', () => {
  it('keeps Telugu vowel signs: కల (kala) and కాల (kaala) are different songs', () => {
    expect(canonKey('కల', 'Singer')).not.toBe(canonKey('కాల', 'Singer'));
  });
  it('keeps Hindi matras: दिल and दल differ', () => {
    expect(canonKey('दिल', 'Singer')).not.toBe(canonKey('दल', 'Singer'));
  });
  it('keeps Tamil vowel signs: கல and கால differ', () => {
    expect(canonKey('கல', 'Singer')).not.toBe(canonKey('கால', 'Singer'));
  });
  it('folds Latin accents and compatibility forms: Café ＝ Cafe', () => {
    expect(canonKey('Café', 'Singer')).toBe(canonKey('Cafe', 'Singer'));
    expect(canonKey('Ｃａｆｅ', 'Singer')).toBe(canonKey('Cafe', 'Singer'));
  });
  it('ignores zero-width joiners and invisible characters', () => {
    expect(canonKey('కల‍', 'Singer')).toBe(canonKey('కల', 'Singer'));
    expect(canonKey('Tum​Hi Ho', 'Singer')).toBe(canonKey('Tum Hi Ho', 'Singer'));
  });
  it('strips version decorations: remasters, covers, lofi flips, film credits, years', () => {
    const base = canonKey('Kesariya', 'Arijit Singh');
    expect(canonKey('Kesariya (2023 Remaster)', 'Arijit Singh')).toBe(base);
    expect(canonKey('Kesariya (Cover)', 'Arijit Singh')).toBe(base);
    expect(canonKey('Kesariya - Lofi Flip', 'Arijit Singh')).toBe(base);
    expect(canonKey('Kesariya (From "Brahmastra")', 'Arijit Singh')).toBe(base);
  });
  it('uses the primary artist only, whichever separator credits use', () => {
    expect(canonKey('Kesariya', 'Arijit Singh, Pritam')).toBe(canonKey('Kesariya', 'Arijit Singh'));
    expect(canonKey('Kesariya', 'Arijit Singh & Pritam')).toBe(canonKey('Kesariya', 'Arijit Singh'));
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalKey, recordingKey, versionKind, versionTag } from '../functions/_lib/identityCore';

const root = (rel: string): string => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
interface Vectors { same: Array<{ why: string; a: [string, string]; b: [string, string] }>; different: Array<{ why: string; a: [string, string]; b: [string, string] }>; recording: Array<{ title: string; tag: string; kind: string }> }
const vectors = JSON.parse(readFileSync(root('shared/identity-vectors.json'), 'utf8')) as Vectors;

describe('the shared identity contract', () => {
  it('the Worker copy of identityCore is byte-identical to the app copy', () => {
    const worker = readFileSync(root('backend/worker/functions/_lib/identityCore.ts'), 'utf8');
    const app = readFileSync(root('frontend/src/services/recommendation/identityCore.ts'), 'utf8');
    expect(worker).toBe(app);
  });
  it.each(vectors.same)('same work: $why', ({ a, b }) => {
    expect(canonicalKey(...a)).toBe(canonicalKey(...b));
  });
  it.each(vectors.different)('different songs: $why', ({ a, b }) => {
    expect(canonicalKey(...a)).not.toBe(canonicalKey(...b));
  });
  it.each(vectors.recording)('recording tag of $title', ({ title, tag, kind }) => {
    expect(versionTag(title)).toBe(tag);
    expect(versionKind(title)).toBe(kind);
  });
  it('a remix is the same work but a different recording', () => {
    expect(canonicalKey('Kesariya (Remix)', 'Arijit Singh')).toBe(canonicalKey('Kesariya', 'Arijit Singh'));
    expect(recordingKey('Kesariya (Remix)', 'Arijit Singh')).not.toBe(recordingKey('Kesariya', 'Arijit Singh'));
    expect(recordingKey('Kesariya (2023 Remaster)', 'Arijit Singh')).toBe(recordingKey('Kesariya', 'Arijit Singh'));
  });
});
