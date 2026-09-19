import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalKey, versionKind, versionTag } from './identityCore';
import { dedupeByIdentity } from './songIdentity';
import { makeSong } from '@/__fixtures__/songs';

/** The app half of the shared identity contract (vectors shared with the Worker). */
interface Vectors { same: Array<{ why: string; a: [string, string]; b: [string, string] }>; different: Array<{ why: string; a: [string, string]; b: [string, string] }>; recording: Array<{ title: string; tag: string; kind: string }> }
const vectors = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../shared/identity-vectors.json', import.meta.url)), 'utf8')) as Vectors;

describe('identity contract vectors', () => {
  it.each(vectors.same)('same work: $why', ({ a, b }) => expect(canonicalKey(...a)).toBe(canonicalKey(...b)));
  it.each(vectors.different)('different songs: $why', ({ a, b }) => expect(canonicalKey(...a)).not.toBe(canonicalKey(...b)));
  it.each(vectors.recording)('recording tag of $title', ({ title, tag, kind }) => {
    expect(versionTag(title)).toBe(tag);
    expect(versionKind(title)).toBe(kind);
  });
});

describe('a listener who chose a version keeps getting that version', () => {
  it('prefers the requested recording within a family, and the original otherwise', () => {
    const original = makeSong('o', { title: 'Monica', artist: 'Anirudh' });
    const lofi = makeSong('l', { title: 'Monica - Lofi Flip', artist: 'Anirudh' });
    expect(dedupeByIdentity([lofi, original], (s) => s).map((s) => s.id)).toEqual(['o']);
    expect(dedupeByIdentity([original, lofi], (s) => s, { preferTag: 'flip+lofi' }).map((s) => s.id)).toEqual(['l']);
  });
});
