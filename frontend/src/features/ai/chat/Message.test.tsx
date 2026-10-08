// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachmentText, foldAttachments, type Attachment } from '@/features/ai/attachments';
import { AssistantMessage, UserMessage, splitAttachedText, type MessageHandlers } from './Message';
import { followAfterScroll } from './MessageList';

const handlers = (): MessageHandlers => ({
  edit: vi.fn(),
  switchVersion: vi.fn(),
  rate: vi.fn(),
  togglePin: vi.fn(),
  branch: vi.fn(),
  regenerate: vi.fn(),
  askWith: vi.fn(),
  reviseLast: vi.fn(),
  continueReply: vi.fn(),
  rewrite: vi.fn(),
  send: vi.fn(),
});
const file = (name: string, text: string, over: Partial<Attachment> = {}): Attachment => ({ kind: 'text', name, path: name, key: name, size: text.length, text, ...over });
const LONG = Array.from({ length: 300 }, (_, i) => `row ${i + 1}`).join('\n');

afterEach(cleanup);

describe('attached files in the listener’s bubble (11.0)', () => {
  it('reads the typed message and each file back out of what the model was sent', () => {
    const content = foldAttachments('Summarise these', [file('notes/a.txt', 'alpha\nbeta'), file('b.pdf', 'gamma', { kind: 'pdf', shortened: true })]);
    expect(splitAttachedText(content)).toEqual({
      typed: 'Summarise these',
      files: [
        { path: 'notes/a.txt', excerpt: false, text: 'alpha\nbeta' },
        { path: 'b.pdf', excerpt: true, text: 'gamma' },
      ],
    });
    expect(splitAttachedText('just a message')).toEqual({ typed: 'just a message', files: [] });
  });

  it('shows a compact chip, not 300 lines of text; the contents open on request', () => {
    const h = handlers();
    const content = foldAttachments('Summarise this', [file('data/report.txt', LONG)]);
    const { container } = render(<UserMessage m={{ role: 'user', content }} index={0} busy={false} handlers={h} />);
    expect(screen.getByText('Summarise this')).toBeTruthy();
    expect(screen.getByText('report.txt')).toBeTruthy();
    expect(screen.getByText(/TXT file · 300 lines/)).toBeTruthy();
    expect(container.textContent).not.toContain('row 150');
    expect(container.textContent).not.toContain('--- File:');
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(screen.getByText('Hide contents')).toBeTruthy();
    expect(container.querySelector('pre')?.textContent).toContain('row 150');
    // 11.2 — Edit opens the typed text in place; the file text goes out again with it.
    fireEvent.click(screen.getByTitle('Edit this message'));
    const editor = screen.getByRole('textbox', { name: 'Edit your message' }) as HTMLTextAreaElement;
    expect(editor.value).toBe('Summarise this');
    fireEvent.change(editor, { target: { value: 'Summarise this, briefly' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(h.edit).toHaveBeenCalledWith(0, content.replace('Summarise this', 'Summarise this, briefly'));
  });

  it('a chat stored before 11.0 (file text already inside the message) and a file-only message both read cleanly', () => {
    const stored = `What is this?${attachmentText(file('old.csv', 'a,b\n1,2'))}`;
    const { container, unmount } = render(<UserMessage m={{ role: 'user', content: stored }} index={0} busy={false} handlers={handlers()} />);
    expect(screen.getByText('What is this?')).toBeTruthy();
    expect(screen.getByText(/CSV file · 2 lines/)).toBeTruthy();
    expect(container.textContent).not.toContain('a,b');
    unmount();
    const only = render(<UserMessage m={{ role: 'user', content: foldAttachments('', [file('solo.md', 'one')]) }} index={0} busy={false} handlers={handlers()} />);
    expect(only.container.querySelector('.ai-user-bubble p')).toBeNull();
    expect(screen.getByText(/MD file · 1 line$/)).toBeTruthy();
  });
});

describe('a failed turn offers the step that can work (11.0)', () => {
  const reply = (over: object): void => {
    render(
      <MemoryRouter>
        <AssistantMessage m={{ role: 'assistant', content: 'It failed.', failed: true, ...over }} index={1} last streaming={false} busy={false} speaking={false} speakKey="" handlers={h} />
      </MemoryRouter>,
    );
  };
  let h = handlers();
  it('turned away as it is: Edit message, and no Retry', () => {
    h = handlers();
    reply({ needsEdit: true });
    expect(screen.queryByLabelText('Retry this question')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    expect(h.reviseLast).toHaveBeenCalledTimes(1);
    expect(h.regenerate).not.toHaveBeenCalled();
  });
  it('any other failure keeps Retry', () => {
    h = handlers();
    reply({});
    expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Retry this question'));
    expect(h.regenerate).toHaveBeenCalledTimes(1);
  });
});

describe('following the newest reply (11.0)', () => {
  const at = (v: Partial<Parameters<typeof followAfterScroll>[0]>) => followAfterScroll({ top: 1000, lastTop: 1000, height: 1600, client: 600, pinned: true, ...v });
  it('stays pinned, and scrolls again, when the thread grew under a reader who did not move', () => {
    // The finished reply's action row added ~110px after the last scroll.
    expect(at({ height: 1710 })).toEqual({ pinned: true, rescroll: true });
  });
  it('lets go when the reader scrolled up', () => {
    expect(at({ top: 800 })).toEqual({ pinned: false, rescroll: false });
  });
  it('never pulls down a reader who had already left the bottom', () => {
    expect(at({ top: 400, lastTop: 400, height: 1710, pinned: false })).toEqual({ pinned: false, rescroll: false });
  });
  it('is pinned again once the reader is back near the bottom', () => {
    expect(at({ top: 960, lastTop: 400, pinned: false })).toEqual({ pinned: true, rescroll: false });
  });
});

describe('11.2 — a picked model that gave no answer', () => {
  const issueMsg = (reason: string) => ({
    role: 'assistant' as const,
    content: 'Gemini 2.5 Flash has used up its free requests for today.',
    failed: true,
    pickIssue: {
      reason: reason as 'quota',
      provider: 'gemini' as const,
      model: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      alternatives: [
        { provider: 'gemini' as const, model: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite' },
        { provider: 'gemini' as const, model: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite' },
        { provider: 'gemini' as const, model: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      ],
    },
  });
  const show = (reason: string, h: MessageHandlers) =>
    render(
      <MemoryRouter>
        <AssistantMessage m={issueMsg(reason)} index={1} last streaming={false} busy={false} speaking={false} speakKey="k" handlers={h} />
      </MemoryRouter>,
    );

  it('out for the day: no Retry; two same-provider models and Auto, each asks again with that choice', () => {
    const h = handlers();
    show('quota', h);
    expect(screen.queryByRole('button', { name: /again/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ask Gemini 2.5 Flash-Lite/ }));
    expect(h.askWith).toHaveBeenCalledWith({ mode: 'model', provider: 'gemini', model: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite' });
    expect(screen.queryByRole('button', { name: /Gemini 2.5 Pro/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use Auto' }));
    expect(h.askWith).toHaveBeenLastCalledWith({ mode: 'auto' });
  });

  it('busy or down: Retry asks the same model again', () => {
    const h = handlers();
    show('busy', h);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Gemini 2.5 Flash again' }));
    expect(h.regenerate).toHaveBeenCalled();
  });
});

describe('11.2 — editing a message in place', () => {
  it('opens an editor in the bubble: focused, Esc cancels, Shift+Enter does not send, empty cannot send', () => {
    const h = handlers();
    render(<UserMessage m={{ role: 'user', content: 'hello there' }} index={2} busy={false} handlers={h} />);
    fireEvent.click(screen.getByTitle('Edit this message'));
    const editor = screen.getByRole('textbox', { name: 'Edit your message' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe('hello there');
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    expect(h.edit).not.toHaveBeenCalled();
    fireEvent.change(editor, { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Send edited message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(h.edit).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Edit your message' })).toBeNull();
    expect(screen.getByText('hello there')).toBeTruthy();
    expect(h.edit).not.toHaveBeenCalled();
    // Cancel does the same; Send sends the new text for this message.
    fireEvent.click(screen.getByTitle('Edit this message'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
    expect(screen.queryByRole('textbox', { name: 'Edit your message' })).toBeNull();
    fireEvent.click(screen.getByTitle('Edit this message'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit your message' }), { target: { value: 'hello again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send edited message' }));
    expect(h.edit).toHaveBeenCalledWith(2, 'hello again');
    expect(screen.queryByRole('textbox', { name: 'Edit your message' })).toBeNull();
  });

  it('no Edit while a reply is being written, and the editor cannot send then', () => {
    const h = handlers();
    const { rerender } = render(<UserMessage m={{ role: 'user', content: 'hi' }} index={0} busy={false} handlers={h} />);
    fireEvent.click(screen.getByTitle('Edit this message'));
    rerender(<UserMessage m={{ role: 'user', content: 'hi' }} index={0} busy handlers={h} />);
    expect((screen.getByRole('button', { name: 'Send edited message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit your message' }), { key: 'Enter' });
    expect(h.edit).not.toHaveBeenCalled();
    cleanup();
    render(<UserMessage m={{ role: 'user', content: 'hi' }} index={0} busy handlers={h} />);
    expect(screen.queryByTitle('Edit this message')).toBeNull();
  });

  it('shows ‹ 2 / 2 › under an edited message, announced, and switches by index', () => {
    const h = handlers();
    const m = {
      role: 'user' as const,
      content: 'new',
      version: 1,
      versions: [
        { content: 'old', after: [] },
        { content: 'new', after: [] },
      ],
    };
    const { container } = render(<UserMessage m={m} index={4} busy={false} handlers={h} />);
    const count = container.querySelector('[aria-live="polite"]');
    expect(count?.textContent).toBe('Version 2 / 2');
    expect((screen.getByRole('button', { name: 'Next version' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }));
    expect(h.switchVersion).toHaveBeenCalledWith(4, 0);
    cleanup();
    render(<UserMessage m={{ role: 'user', content: 'never edited' }} index={0} busy={false} handlers={h} />);
    expect(screen.queryByRole('button', { name: 'Previous version' })).toBeNull();
  });
});

