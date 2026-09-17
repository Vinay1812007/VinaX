// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { arrangePalette, fuzzyScore } from './CommandPalette';

const COMMANDS = ['Play / Pause Player', 'Next track Player', 'Previous track Player', 'Toggle theme Appearance'];
const score = (q: string) => COMMANDS.map((e) => ({ e, s: fuzzyScore(q, e) }));

describe('command palette ordering', () => {
  it('typing a command name + Enter runs the command, not a song', () => {
    const list = arrangePalette(score('next'), ['song: Next To Me', 'song: Next Level']);
    expect(list[0]).toBe('Next track Player');
    expect(list.slice(1, 3)).toEqual(['song: Next To Me', 'song: Next Level']);
  });

  it('songs still lead the loose (subsequence-only) command matches', () => {
    // "ptk" is a subsequence of "Previous track", never a substring of anything.
    const list = arrangePalette(score('ptk'), ['song: PTK Anthem']);
    expect(list[0]).toBe('song: PTK Anthem');
    expect(list).toContain('Previous track Player');
  });

  it('drops non-matching commands and caps the list', () => {
    expect(arrangePalette(score('zzzz'), ['song: Zzzz'])).toEqual(['song: Zzzz']);
    const many = Array.from({ length: 20 }, (_, i) => `song: ${i}`);
    expect(arrangePalette(score('kesariya'), many)).toHaveLength(12);
  });

  it('with no query every command is listed', () => {
    expect(arrangePalette(score(''), [], COMMANDS.length)).toEqual(COMMANDS);
  });
});
