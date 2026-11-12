// @vitest-environment jsdom
/**
 * VinaX AI — thinking levels on the page: the saved choice (and the old
 * Extended thinking switch), the meta event's routing kept on the reply, the
 * reply footer, and the nearest-level notes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { chatReducer, initialChat, type ChatAction } from './chatState';
import { RouteInfo, timeLabel } from './Message';
import { levelNote, nearestLevel } from './ThinkingPicker';
import type { ChatMessage, PickerModel, StreamEvent } from './types';

afterEach(() => { cleanup(); localStorage.clear(); });

const MODEL = { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' };

describe('the saved Thinking choice', () => {
  it('defaults to Auto; the old Extended thinking switch becomes Extended; bad values fall back', async () => {
    const { PREFS_KEY } = await import('./prefs');
    vi.resetModules();
    expect((await import('./prefs')).usePrefs.getState().thinking).toBe('auto');
    vi.resetModules();
    localStorage.setItem(PREFS_KEY, JSON.stringify({ extendedThinking: true }));
    expect((await import('./prefs')).usePrefs.getState().thinking).toBe('extended');
    vi.resetModules();
    localStorage.setItem(PREFS_KEY, JSON.stringify({ thinking: 'max', extendedThinking: false }));
    expect((await import('./prefs')).usePrefs.getState().thinking).toBe('max');
    vi.resetModules();
    localStorage.setItem(PREFS_KEY, JSON.stringify({ thinking: 'turbo' }));
    expect((await import('./prefs')).usePrefs.getState().thinking).toBe('auto');
  });
});

describe('meta routing on the reply', () => {
  it('keeps the thinking level and Auto’s judgement on the streaming reply', () => {
    const ev = (e: StreamEvent): ChatAction => ({ type: 'stream', ev: e, now: 1 });
    const s = [
      { type: 'send', text: 'Solve x^2 = 4', parentId: null, now: '2026-11-12T10:00:00Z' } as ChatAction,
      ev({ event: 'meta', data: { conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', model: MODEL, thinking: { choice: 'auto', level: 'extended', used: 'extended' }, route: { task: 'Maths', complexity: 'hard' } } }),
    ].reduce(chatReducer, initialChat());
    expect(s.messages.a1.routing).toEqual({ thinking: { choice: 'auto', level: 'extended', used: 'extended' }, route: { task: 'Maths', complexity: 'hard' } });
  });
});

describe('<RouteInfo />', () => {
  const reply = (over: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'a1', parentId: 'u1', role: 'assistant', text: 'x', thinking: '', thinkingMs: null, model: MODEL, stopReason: 'end', error: null, createdAt: new Date().toISOString(), ...over,
  });

  it('names the model, the level when not Standard, and what Auto judged', () => {
    render(<RouteInfo message={reply({ routing: { thinking: { choice: 'auto', level: 'extended', used: 'extended' }, route: { task: 'Maths', complexity: 'hard' } } })} />);
    expect(screen.getByText('GPT-OSS 120B · Groq · Extended thinking · Auto: Maths, hard')).toBeTruthy();
  });

  it('says when the level asked for was not on that model', () => {
    render(<RouteInfo message={reply({ routing: { thinking: { choice: 'max', level: 'max', used: 'extended' } } })} />);
    expect(screen.getByText('Maximum thinking isn’t available on GPT-OSS 120B, so it used Extended.')).toBeTruthy();
  });

  it('no fallback note when Thinking was left on Auto', () => {
    render(<RouteInfo message={reply({ routing: { thinking: { choice: 'auto', level: 'fast', used: 'standard' }, route: { task: 'Conversation', complexity: 'simple' } } })} />);
    expect(screen.queryByText(/isn’t available/)).toBeNull();
    expect(screen.getByText('GPT-OSS 120B · Groq · Auto: Conversation, simple')).toBeTruthy();
  });

  it('a reply loaded from history shows only the model and its time', () => {
    const { container } = render(<RouteInfo message={reply()} />);
    expect(screen.getByText('GPT-OSS 120B · Groq')).toBeTruthy();
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBeTruthy();
  });

  it('timeLabel: the time today, the date too on other days, nothing for a bad date', () => {
    const now = new Date('2026-11-12T15:00:00');
    expect(timeLabel('2026-11-12T14:05:00', now)).toMatch(/14|2/);
    expect(timeLabel('2026-11-01T14:05:00', now)).toMatch(/Nov|11/);
    expect(timeLabel('nope', now)).toBeNull();
  });
});

describe('nearest levels', () => {
  const m = (levels: PickerModel['thinkingLevels']): PickerModel => ({ id: 'x', name: 'X', provider: 'P', group: 'fast', description: '', flags: { vision: false, web: false, thinking: true, code: false }, available: true, thinkingLevels: levels });
  it('mirrors the Worker: Maximum → Extended → Standard', () => {
    expect(nearestLevel(['fast', 'standard', 'extended'], 'max')).toBe('extended');
    expect(nearestLevel(['standard'], 'fast')).toBe('standard');
    expect(nearestLevel(undefined, 'extended')).toBe('standard');
  });
  it('notes a fallback for a picked model, and for Auto only when no model has the level', () => {
    expect(levelNote('max', m(['standard']), [])).toBe('X uses Standard');
    expect(levelNote('max', null, [m(['standard', 'extended'])])).toBe('No model offers Maximum right now');
    expect(levelNote('max', null, [m(['fast', 'standard', 'extended', 'max'])])).toBeNull();
    expect(levelNote('auto', m(['standard']), [])).toBeNull();
    expect(levelNote('max', m(undefined), [])).toBeNull();
    expect(levelNote('max', null, [m(undefined)])).toBeNull();
    // Auto model whose ladders stop at Extended: say so, and name a model that has Maximum.
    expect(levelNote('max', null, [{ ...m(['fast', 'standard', 'extended', 'max']), name: 'Gemini 3.6 Flash' }], ['fast', 'standard', 'extended'])).toBe('Auto uses Extended; pick Gemini 3.6 Flash for Maximum');
    expect(levelNote('extended', null, [m(['standard'])], ['fast', 'standard', 'extended'])).toBeNull();
  });
});

describe('reading progress', () => {
  it('the progress event is kept on the reply and read out in words', async () => {
    const { progressText } = await import('./Sources');
    const { SseParser } = await import('./sse');
    // An older page's parser drops unknown events; this one keeps progress.
    expect(new SseParser().push('event: progress\ndata: {"step":"reading","count":1,"names":["a.png"]}\n\n')).toEqual([{ event: 'progress', data: { step: 'reading', count: 1, names: ['a.png'] } }]);
    const ev = (e: StreamEvent): ChatAction => ({ type: 'stream', ev: e, now: 1 });
    const s = [
      { type: 'send', text: 'Summarise', parentId: null, now: '2026-11-12T10:00:00Z' } as ChatAction,
      ev({ event: 'meta', data: { conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', model: MODEL } }),
      ev({ event: 'progress', data: { step: 'reading', count: 3, names: ['report.pdf', 'notes.txt'] } }),
    ].reduce(chatReducer, initialChat());
    expect(s.messages.a1.progress).toEqual({ step: 'reading', count: 3, names: ['report.pdf', 'notes.txt'] });
    expect(progressText({ step: 'reading', count: 3, names: ['report.pdf'] })).toBe('Reading report.pdf and 2 more files');
    expect(progressText({ step: 'reading', count: 1, names: ['a.png'] })).toBe('Reading a.png');
    expect(progressText({ step: 'reading', count: 2, names: [] })).toBe('Reading 2 files');
  });
});
