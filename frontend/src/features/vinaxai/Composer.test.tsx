// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer } from './Composer';

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = { value: 'Hello', onChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn(), streaming: false, ...over };
  render(<Composer {...props} />);
  return { ...props, box: screen.getByRole('textbox', { name: 'Message VinaX AI' }) };
}

describe('<Composer />', () => {
  it('Enter sends; Shift+Enter does not', () => {
    const { box, onSend } = setup();
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('Enter while an IME is composing does not send', () => {
    const { box, onSend } = setup();
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('an empty message cannot be sent', () => {
    const { box, onSend } = setup({ value: '   ' });
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Send becomes Stop while a reply is written', () => {
    const { box, onSend, onStop } = setup({ streaming: true });
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('the Stop button is never reused as the Send button (a click on Stop must not submit)', () => {
    const props = { value: 'Hello', onChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn() };
    const { rerender } = render(<Composer {...props} streaming />);
    const stop = screen.getByRole('button', { name: 'Stop' });
    rerender(<Composer {...props} streaming={false} />);
    expect(screen.getByRole('button', { name: 'Send message' })).not.toBe(stop);
    expect(stop.isConnected).toBe(false);
  });

  it('typing reports the new text', () => {
    const { box, onChange } = setup({ value: '' });
    fireEvent.change(box, { target: { value: 'raga' } });
    expect(onChange).toHaveBeenCalledWith('raga');
  });
});

describe('<Composer /> + menu', () => {
  it('toggles Extended thinking and shows it on the composer', () => {
    const onThinking = vi.fn();
    const { rerender } = render(<Composer value="" onChange={vi.fn()} onSend={vi.fn()} onStop={vi.fn()} streaming={false} thinking={false} onThinking={onThinking} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    const item = screen.getByRole('menuitemcheckbox', { name: /Extended thinking/ });
    expect(item.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(item);
    expect(onThinking).toHaveBeenCalledWith(true);
    rerender(<Composer value="" onChange={vi.fn()} onSend={vi.fn()} onStop={vi.fn()} streaming={false} thinking onThinking={onThinking} />);
    expect(screen.getAllByText('Extended thinking').length).toBeGreaterThan(0);
  });
});

describe('<Composer /> web search', () => {
  it('offers Auto / On / Off when search is available, and shows when it is on', () => {
    const onChange = vi.fn();
    const props = { value: '', onChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn(), streaming: false, thinking: false, onThinking: vi.fn() };
    const { rerender } = render(<Composer {...props} search={{ value: 'auto', onChange }} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    fireEvent.click(radios[1]);
    expect(onChange).toHaveBeenCalledWith('on');
    rerender(<Composer {...props} search={{ value: 'on', onChange }} />);
    expect(screen.getAllByText('Web search').length).toBeGreaterThan(0);
    cleanup();
    render(<Composer {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
  });
});

describe('<Composer /> files', () => {
  const props = { value: '', onChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn(), streaming: false, thinking: false, onThinking: vi.fn() };
  it('files alone can be sent; sending waits while files are being added or a model cannot see them', () => {
    const { rerender } = render(<Composer {...props} onFiles={vi.fn()} hasFiles />);
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveProperty('disabled', false);
    rerender(<Composer {...props} onFiles={vi.fn()} hasFiles sendBlocked />);
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveProperty('disabled', true);
  });
  it('the + menu adds files; pasted files go to the tray', () => {
    const onFiles = vi.fn();
    render(<Composer {...props} onFiles={onFiles} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menuitem', { name: /Add photos and files/ })).toBeTruthy();
    const pasted = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(screen.getByRole('textbox', { name: 'Message VinaX AI' }), { clipboardData: { files: [pasted] } });
    expect(onFiles).toHaveBeenCalledWith([pasted]);
  });
});
