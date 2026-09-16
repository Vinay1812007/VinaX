// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { tickCredit } from './listenClock';

const snap = (songId: string | null, time: number, playing = true) => ({ songId, time, playing });

describe('listen clock ticks', () => {
  it('credits normal forward ticks while playing', () => {
    expect(tickCredit(snap('a', 10), snap('a', 10.25))).toBeCloseTo(0.25);
    expect(tickCredit(snap('a', 10), snap('a', 12.9))).toBeCloseTo(2.9);
  });
  it('credits nothing across a pause, a seek, a rewind or a song change', () => {
    expect(tickCredit(snap('a', 10, false), snap('a', 11))).toBe(0);
    expect(tickCredit(snap('a', 10), snap('a', 11, false))).toBe(0);
    expect(tickCredit(snap('a', 10), snap('a', 60))).toBe(0); // seek forward
    expect(tickCredit(snap('a', 60), snap('a', 10))).toBe(0); // seek back / replay wrap
    expect(tickCredit(snap('a', 10), snap('b', 10.2))).toBe(0);
    expect(tickCredit(snap(null, 0), snap('a', 0.2))).toBe(0);
  });
  it('a replay keeps counting once the clock advances again', () => {
    expect(tickCredit(snap('a', 200), snap('a', 0.1))).toBe(0);
    expect(tickCredit(snap('a', 0.1), snap('a', 0.4))).toBeCloseTo(0.3);
  });
});
