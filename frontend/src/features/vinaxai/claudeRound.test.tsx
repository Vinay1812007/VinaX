// @vitest-environment jsdom
/**
 * VinaX AI, the Claude round (2026-11-18): tables as CSV, the keyboard
 * shortcuts, the quote above the composer, "ago" labels, the research
 * progress lines, the Research switch in the + menu and its pill, and the
 * reply language in the request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer } from './Composer';
import { Markdown } from './Markdown';
import { agoLabel } from './RecentChats';
import { keyLabel, matchShortcut, SHORTCUTS } from './shortcuts';
import { queriesText, statusText } from './Sources';
import { csvCell, tableRows, tableToCsv } from './tableCsv';
import { replySelection, withQuote } from './useSelectionAsk';
import { personalOf } from './prefs';

afterEach(cleanup);

describe('tables as CSV', () => {
  it('reads header and body rows from the rendered tree; quotes commas, quotes and line breaks', () => {
    const table = {
      type: 'element', tagName: 'table', children: [
        { type: 'element', tagName: 'thead', children: [{ type: 'element', tagName: 'tr', children: [
          { type: 'element', tagName: 'th', children: [{ type: 'text', value: 'Song' }] },
          { type: 'element', tagName: 'th', children: [{ type: 'text', value: 'Year' }] },
        ] }] },
        { type: 'element', tagName: 'tbody', children: [{ type: 'element', tagName: 'tr', children: [
          { type: 'element', tagName: 'td', children: [{ type: 'element', tagName: 'strong', children: [{ type: 'text', value: 'Vaseegara, live' }] }] },
          { type: 'element', tagName: 'td', children: [{ type: 'text', value: '2003' }] },
        ] }] },
      ],
    };
    expect(tableRows(table)).toEqual([['Song', 'Year'], ['Vaseegara, live', '2003']]);
    expect(tableToCsv(table)).toBe('Song,Year\n"Vaseegara, live",2003');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('  a   b ')).toBe('a b');
  });

  it('a table in a reply gets a Copy as CSV button that copies it', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = render(<Markdown text={'| a | b |\n|---|---|\n| 1 | 2 |'} />);
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="Copy table as CSV"]');
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('a,b\n1,2'));
  });
});

describe('keyboard shortcuts', () => {
  const press = (over: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({ key: 'x', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over });
  it('⌘ on a Mac, Ctrl elsewhere; Shift+Esc goes to the message box; Alt never matches', () => {
    expect(matchShortcut(press({ key: 'O', metaKey: true, shiftKey: true }), true)).toBe('new-chat');
    expect(matchShortcut(press({ key: 'O', ctrlKey: true, shiftKey: true }), true)).toBeNull();
    expect(matchShortcut(press({ key: 'o', ctrlKey: true, shiftKey: true }), false)).toBe('new-chat');
    expect(matchShortcut(press({ key: 'K', metaKey: true, shiftKey: true }), true)).toBe('search-chats');
    expect(matchShortcut(press({ key: 'k', metaKey: true }), true)).toBeNull(); // the app's command palette
    expect(matchShortcut(press({ key: 'S', metaKey: true, shiftKey: true }), true)).toBe('toggle-sidebar');
    expect(matchShortcut(press({ key: 'C', metaKey: true, shiftKey: true }), true)).toBe('copy-last');
    expect(matchShortcut(press({ key: ',', metaKey: true }), true)).toBe('settings');
    expect(matchShortcut(press({ key: '/', ctrlKey: true }), false)).toBe('help');
    expect(matchShortcut(press({ key: 'Escape', shiftKey: true }), true)).toBe('focus-composer');
    expect(matchShortcut(press({ key: 'Escape' }), true)).toBeNull();
    expect(matchShortcut(press({ key: 'o', metaKey: true, shiftKey: true, altKey: true }), true)).toBeNull();
  });
  it('every listed shortcut matches its own keys, and the keys print as keycaps', () => {
    for (const s of SHORTCUTS) {
      const key = s.keys[s.keys.length - 1];
      const ev = press({ key: key === 'Esc' ? 'Escape' : key, metaKey: s.keys.includes('Mod'), shiftKey: s.keys.includes('Shift') });
      expect(matchShortcut(ev, true)).toBe(s.id);
    }
    expect(SHORTCUTS.map((s) => s.keys.map((k) => keyLabel(k, true)).join(''))).toContain('⌘⇧O');
    expect(keyLabel('Mod', false)).toBe('Ctrl');
  });
});

describe('the quote above the composer', () => {
  it('goes above the question as a Markdown quote; nothing to quote leaves the text alone', () => {
    expect(withQuote('an evening raga', 'Why evening?')).toBe('> an evening raga\n\nWhy evening?');
    expect(withQuote('line one\nline two', '')).toBe('> line one\n> line two');
    expect(withQuote(null, 'plain')).toBe('plain');
    expect(withQuote('  ', 'plain')).toBe('plain');
  });

  it('only a selection inside one finished reply counts', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="vx-ai-turn-reply"><div class="vx-ai-md"><p>Yaman is an evening raga of the Kalyan thaat.</p></div></div><div class="vx-ai-turn-user"><div class="vx-ai-bubble">What is Yaman?</div></div>';
    document.body.appendChild(root);
    const p = root.querySelector('p')!.firstChild as Text;
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(p, 12);
    range.setEnd(p, 24);
    sel.removeAllRanges();
    sel.addRange(range);
    expect(replySelection(root, sel)?.text).toBe('evening raga');
    // The listener's own bubble is never quoted.
    const bubble = root.querySelector('.vx-ai-bubble')!.firstChild as Text;
    range.setStart(bubble, 0);
    range.setEnd(bubble, 4);
    sel.removeAllRanges();
    sel.addRange(range);
    expect(replySelection(root, sel)).toBeNull();
    // A reply still being written is left alone.
    root.querySelector('.vx-ai-turn-reply')!.setAttribute('aria-busy', 'true');
    range.setStart(p, 12);
    range.setEnd(p, 24);
    sel.removeAllRanges();
    sel.addRange(range);
    expect(replySelection(root, sel)).toBeNull();
    root.remove();
  });
});

describe('recent chats', () => {
  it('says how long ago a chat was active', () => {
    const now = Date.UTC(2026, 10, 18, 12, 0, 0);
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(agoLabel(at(10_000), now)).toBe('Just now');
    expect(agoLabel(at(12 * 60_000), now)).toBe('12 min ago');
    expect(agoLabel(at(3 * 3_600_000), now)).toBe('3 h ago');
    expect(agoLabel(at(26 * 3_600_000), now)).toBe('Yesterday');
    expect(agoLabel(at(4 * 86_400_000), now)).toBe('4 days ago');
    expect(agoLabel('junk', now)).toBe('');
  });
});

describe('research progress', () => {
  it('names each step, and the searches under the sources', () => {
    expect(statusText({ step: 'planning' })).toBe('Planning the research');
    expect(statusText({ step: 'researching', queries: ['a', 'b', 'c', 'd'], done: 0 })).toBe('Researching 4 searches: a · b · c …');
    expect(statusText({ step: 'researching', queries: ['a', 'b'], done: 1 })).toBe('Researching: 1 of 2 searches done');
    expect(statusText({ step: 'research_limit' })).toBe('Today’s research is used up, so this reply searches once');
    expect(queriesText(['india final', 'scorecard'])).toBe('Searched: india final · scorecard');
    expect(queriesText([])).toBeNull();
  });
});

describe('the Research switch', () => {
  it('lives in the + menu, shows a pill with × when on, and changes the placeholder', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Composer value="" onChange={vi.fn()} onSend={vi.fn()} onStop={vi.fn()} streaming={false} research={{ on: false, onChange }} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    const item = screen.getByRole('menuitemcheckbox', { name: /Research/ });
    expect(item.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(item);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Composer value="" onChange={vi.fn()} onSend={vi.fn()} onStop={vi.fn()} streaming={false} research={{ on: true, onChange }} />);
    expect(screen.getByText('Research', { selector: '.vx-ai-pill' })).toBeTruthy();
    // The box's name follows its placeholder (the label is the same text).
    expect(screen.getByRole('textbox', { name: 'What should VinaX AI research?' }).getAttribute('placeholder')).toBe('What should VinaX AI research?');
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Research' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});

describe('the reply language', () => {
  it('travels with the personal block, and auto sends nothing', () => {
    const base = { personalName: '', personalAbout: '', personalInstructions: '', style: 'normal' as const };
    expect(personalOf({ ...base, replyLanguage: 'auto' })).toBeUndefined();
    expect(personalOf({ ...base, replyLanguage: 'te' })).toEqual({ language: 'te' });
    expect(personalOf({ ...base, personalName: 'Ash', replyLanguage: 'hi' })).toEqual({ name: 'Ash', language: 'hi' });
  });
});
