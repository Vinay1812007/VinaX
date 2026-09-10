/**
 * The key decoder — the layer that decides whether arrow keys work.
 *
 * Every sequence here is what a real terminal actually sends. The decoder has
 * no reference to stdin, so these are exact, deterministic assertions rather
 * than "it seemed to work on my machine".
 */
import { describe, expect, it } from 'vitest';
import { createKeyDecoder, isCtrl, type Key } from '../src/terminal/keys.js';

const ESC = '\u001b';
const DEL = '\u007f';
const ctrlByte = (letter: string): string => String.fromCharCode(letter.charCodeAt(0) - 96);

/** Feed chunks, collect every decoded key. */
function decode(...chunks: string[]): Key[] {
  const d = createKeyDecoder();
  const out: Key[] = [];
  for (const c of chunks) out.push(...d.push(c));
  return out;
}

const names = (keys: Key[]): string[] => keys.map((k) => k.name);

describe('arrow keys', () => {
  it('decodes the xterm form', () => {
    expect(names(decode(`${ESC}[A`, `${ESC}[B`, `${ESC}[C`, `${ESC}[D`))).toEqual(['up', 'down', 'right', 'left']);
  });

  it('decodes the APPLICATION CURSOR form that Terminal.app and iTerm send', () => {
    // This is the form a decoder that only knows ESC [ misses entirely, and
    // the reason arrows "type garbage" in a naive prompt on macOS.
    expect(names(decode(`${ESC}OA`, `${ESC}OB`, `${ESC}OC`, `${ESC}OD`))).toEqual(['up', 'down', 'right', 'left']);
  });

  it('reassembles an arrow split across three reads', () => {
    expect(names(decode(ESC, '[', 'A'))).toEqual(['up']);
  });

  it('NEVER leaks an escape sequence into typed text', () => {
    const keys = decode('hello', `${ESC}[D`, `${ESC}[D`, 'X', `${ESC}OA`);
    for (const k of keys.filter((x) => x.name === 'char')) {
      expect(k.text, `"${k.text}" must not contain an escape`).not.toContain(ESC);
      expect(k.text).not.toMatch(/\[[ABCD]/);
    }
    expect(names(keys)).toEqual(['char', 'left', 'left', 'char', 'up']);
  });
});

describe('editing and navigation keys', () => {
  it('decodes Enter, Tab, Backspace and Delete', () => {
    expect(names(decode('\r'))).toEqual(['enter']);
    // A bare LF is Ctrl+J — "insert a newline" — not a second Enter. In raw
    // mode the terminal sends CR for Enter, so the two are distinguishable.
    const lf = decode('\n')[0];
    expect(lf).toMatchObject({ name: 'char', ctrl: true, text: 'j' });
    expect(names(decode('\t'))).toEqual(['tab']);
    expect(names(decode(DEL))).toEqual(['backspace']);
    expect(names(decode('\b'))).toEqual(['backspace']);
    expect(names(decode(`${ESC}[3~`))).toEqual(['delete']);
  });

  it('decodes Home, End, PageUp, PageDown in both forms', () => {
    expect(names(decode(`${ESC}[H`, `${ESC}[F`))).toEqual(['home', 'end']);
    expect(names(decode(`${ESC}[1~`, `${ESC}[4~`))).toEqual(['home', 'end']);
    expect(names(decode(`${ESC}OH`, `${ESC}OF`))).toEqual(['home', 'end']);
    expect(names(decode(`${ESC}[5~`, `${ESC}[6~`))).toEqual(['pageup', 'pagedown']);
  });

  it('decodes Shift+Tab', () => {
    expect(names(decode(`${ESC}[Z`))).toEqual(['shift-tab']);
  });

  it('decodes a lone Escape once the app flushes it', () => {
    // A bare ESC is ambiguous until either more bytes arrive or a moment
    // passes; the app owns that timing, so the test flushes explicitly.
    const d = createKeyDecoder();
    expect(d.push(ESC)).toEqual([]);
    expect(d.pending()).toBe(true);
    expect(names(d.flush())).toEqual(['escape']);
    expect(d.pending()).toBe(false);
  });

  it('a flush with nothing held emits nothing', () => {
    const d = createKeyDecoder();
    d.push('abc');
    expect(d.flush()).toEqual([]);
  });

  it('decodes Ctrl+letter', () => {
    const keys = decode(ctrlByte('a'), ctrlByte('e'), ctrlByte('u'), ctrlByte('k'), ctrlByte('w'), ctrlByte('d'));
    expect(keys.every((k) => k.ctrl)).toBe(true);
    expect(keys.map((k) => k.text)).toEqual(['a', 'e', 'u', 'k', 'w', 'd']);
    expect(isCtrl(keys[0], 'a')).toBe(true);
    expect(isCtrl(keys[0], 'e')).toBe(false);
  });

  it('decodes word motion in every form a terminal reports it', () => {
    // xterm modifier parameters, and the ESC b / ESC f that Terminal.app
    // sends when Option is configured as Meta.
    expect(names(decode(`${ESC}[1;5C`, `${ESC}[1;5D`))).toEqual(['word-right', 'word-left']);
    expect(names(decode(`${ESC}[1;3C`, `${ESC}[1;3D`))).toEqual(['word-right', 'word-left']);
    expect(names(decode(`${ESC}b`, `${ESC}f`))).toEqual(['word-left', 'word-right']);
  });
});

describe('typed text', () => {
  it('groups a run of printable characters into one key', () => {
    const keys = decode('hello');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ name: 'char', text: 'hello' });
  });

  it('keeps multi-byte characters intact', () => {
    expect(decode('héllo 👋')[0].text).toBe('héllo 👋');
  });
});

describe('bracketed paste', () => {
  it('delivers a multi-line paste as ONE paste key, not one Enter per line', () => {
    const keys = decode(`${ESC}[200~`, 'line one\nline two\nline three', `${ESC}[201~`);
    expect(names(keys)).toEqual(['paste']);
    expect(keys[0].text).toBe('line one\nline two\nline three');
  });

  it('reassembles a paste split across many chunks', () => {
    const keys = decode(`${ESC}[200~`, 'part one ', 'part two', `${ESC}[20`, '1~');
    expect(names(keys)).toEqual(['paste']);
    expect(keys[0].text).toBe('part one part two');
  });

  it('does not treat text before the paste as part of it', () => {
    const keys = decode('go ', `${ESC}[200~`, 'pasted', `${ESC}[201~`);
    expect(names(keys)).toEqual(['char', 'paste']);
    expect(keys[0].text).toBe('go ');
    expect(keys[1].text).toBe('pasted');
  });
});

describe('decoder state', () => {
  it('reports a partial sequence as pending rather than emitting nonsense', () => {
    const d = createKeyDecoder();
    expect(d.push(`${ESC}[`)).toEqual([]);
    expect(d.pending()).toBe(true);
    expect(names(d.push('A'))).toEqual(['up']);
    expect(d.pending()).toBe(false);
  });

  it('reset discards partial state', () => {
    const d = createKeyDecoder();
    d.push(`${ESC}[`);
    d.reset();
    expect(d.pending()).toBe(false);
    expect(names(d.push('a'))).toEqual(['char']);
  });

  it('handles several keys arriving in a single read', () => {
    expect(names(decode(`abc${ESC}[D${ESC}[Dx\r`))).toEqual(['char', 'left', 'left', 'char', 'enter']);
  });
});
