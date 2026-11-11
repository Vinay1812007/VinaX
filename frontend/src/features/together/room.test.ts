// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatRows, ENERGY_FULL, typingText, TYPING_MS, useRoom, type LiveLineMessage } from './room';

const at = '2026-11-11T10:00:00.000Z';
const mine = (id: string, text: string, state: LiveLineMessage['state'] = 'sending'): LiveLineMessage => ({ id, by: 'Me', text, at: Date.parse(at) + 5000, mine: true, state });

beforeEach(() => {
  vi.useFakeTimers();
  useRoom.getState().reset();
});
afterEach(() => vi.useRealTimers());

describe('the chat as it is shown', () => {
  it('a line sent from here is on screen before the server lists it, and is not shown twice once it does', () => {
    const before = chatRows([{ by: 'Asha', text: 'hi', at, id: 'aaaaaa1' }], [mine('bbbbbb2', 'hello')], new Set(['bbbbbb2']));
    expect(before.map((r) => [r.text, r.mine, r.state])).toEqual([['hi', false, 'sent'], ['hello', true, 'sending']]);
    const after = chatRows([{ by: 'Asha', text: 'hi', at, id: 'aaaaaa1' }, { by: 'Me', text: 'hello', at, id: 'bbbbbb2' }], [mine('bbbbbb2', 'hello')], new Set(['bbbbbb2']));
    expect(after.map((r) => [r.text, r.mine, r.state])).toEqual([['hi', false, 'sent'], ['hello', true, 'sent']]);
  });

  it('only the id says a line is mine: two listeners can have the same name', () => {
    const rows = chatRows([{ by: 'Listener', text: 'theirs', at, id: 'aaaaaa1' }, { by: 'Listener', text: 'old app', at }], [], new Set(['zzzzzz9']));
    expect(rows.map((r) => r.mine)).toEqual([false, false]);
  });

  it('lines one person sends in a row are joined under one name; another person, or a long gap, starts again', () => {
    const later = '2026-11-11T10:10:00.000Z';
    const rows = chatRows(
      [
        { by: 'Asha', text: 'one', at, id: 'aaaaaa1' },
        { by: 'Asha', text: 'two', at, id: 'aaaaaa2' },
        { by: 'Ravi', text: 'three', at, id: 'aaaaaa3' },
        { by: 'Ravi', text: 'four', at: later, id: 'aaaaaa4' },
      ],
      [],
      new Set(),
    );
    expect(rows.map((r) => r.joined)).toEqual([false, true, false, false]);
  });

  it('says who is typing', () => {
    expect(typingText([])).toBe('');
    expect(typingText(['Asha'])).toBe('Asha is typing');
    expect(typingText(['Asha', 'Ravi'])).toBe('Asha and Ravi are typing');
    expect(typingText(['Asha', 'Ravi', 'Mo'])).toBe('Several people are typing');
  });
});

describe('the room’s extras', () => {
  it('keeps one copy of a line, marks it, and lets go of it once the server lists it', () => {
    const room = useRoom.getState();
    room.line(mine('bbbbbb2', 'hello'));
    room.line(mine('bbbbbb2', 'hello'));
    expect(useRoom.getState().extra).toHaveLength(1);
    room.mark('bbbbbb2', 'failed');
    expect(useRoom.getState().extra[0].state).toBe('failed');
    room.listed(new Set(['bbbbbb2']));
    expect(useRoom.getState().extra).toHaveLength(0);
  });

  it('"typing" fades by itself unless it is repeated, and stops at once when told', () => {
    const room = useRoom.getState();
    room.setTyping('Asha', true);
    room.setTyping('Ravi', true);
    expect(useRoom.getState().typing).toEqual(['Asha', 'Ravi']);
    room.setTyping('Ravi', false);
    expect(useRoom.getState().typing).toEqual(['Asha']);
    vi.advanceTimersByTime(TYPING_MS - 500);
    room.setTyping('Asha', true);
    vi.advanceTimersByTime(TYPING_MS - 500);
    expect(useRoom.getState().typing).toEqual(['Asha']);
    vi.advanceTimersByTime(600);
    expect(useRoom.getState().typing).toEqual([]);
  });

  it('a reaction rises as one large emoji with the sender’s name and a few small ones, then leaves', () => {
    useRoom.getState().float(['🔥'], 'Asha');
    const floats = useRoom.getState().floats;
    expect(floats.length).toBe(4);
    expect(floats.every((f) => f.e === '🔥' && f.left >= 4 && f.left <= 92)).toBe(true);
    expect(floats.filter((f) => f.by === 'Asha')).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(useRoom.getState().floats).toHaveLength(0);
  });

  it('reactions fill the room’s energy, it fades when the room goes quiet, and a full bar sets the room off once', () => {
    const room = useRoom.getState();
    room.float(['🔥']);
    room.float(['❤️']);
    expect(useRoom.getState().energy).toBe(2);
    vi.advanceTimersByTime(3100);
    expect(useRoom.getState().energy).toBe(0);
    for (let i = 0; i < ENERGY_FULL; i += 1) room.float(['🔥']);
    expect(useRoom.getState()).toMatchObject({ burst: 1, bursting: true, energy: 0 });
    // The whole room's emoji are in the air.
    expect(useRoom.getState().floats.length).toBeGreaterThan(40);
    // Straight after, another full bar does not set it off again.
    for (let i = 0; i < ENERGY_FULL; i += 1) room.float(['🔥']);
    expect(useRoom.getState().burst).toBe(1);
    vi.advanceTimersByTime(4000);
    expect(useRoom.getState().bursting).toBe(false);
    vi.advanceTimersByTime(30_000);
    for (let i = 0; i < ENERGY_FULL; i += 1) room.float(['🎉']);
    expect(useRoom.getState().burst).toBe(2);
  });
});
