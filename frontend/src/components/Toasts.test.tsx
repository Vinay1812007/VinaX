// @vitest-environment jsdom
/**
 * Snackbar stack contract (10.1.0; the toast API since v5.17):
 *   - the polite live region exists BEFORE the first toast (a region that
 *     mounts with its message is not announced), and toasts carry no role;
 *   - hovering / focusing the stack holds the dismiss timers, leaving resumes
 *     them with the time that was left;
 *   - toast(message) keeps working unchanged; toast(message, opts) adds an
 *     artwork thumbnail, one action and a custom duration;
 *   - at most two on screen, ~4 s each, swipe down or Escape to dismiss.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SNACK_EXIT_MS, Toasts } from './Toasts';
import { MAX_TOASTS, TOAST_ACTION_MS, TOAST_MS, toast, toastNavigate, useToastStore } from '@/store/toastStore';

beforeEach(() => {
  vi.useFakeTimers();
  // Most cases assert the store's timing, so the exit motion is switched off
  // the way a listener would (Settings → Reduce motion); one case turns it on.
  document.documentElement.classList.add('reduce-motion');
});
afterEach(() => {
  act(() => {
    for (const t of useToastStore.getState().toasts) useToastStore.getState().dismiss(t.id);
    useToastStore.getState().resume();
  });
  cleanup();
  document.documentElement.classList.remove('reduce-motion');
  vi.useRealTimers();
});

describe('Toasts', () => {
  it('renders the live region while empty, and toasts without their own role', () => {
    render(<Toasts />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.childElementCount).toBe(0);

    act(() => toast('Added to queue'));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(region.textContent).toContain('Added to queue');
  });

  it('a plain toast(text) still works and leaves after about four seconds', () => {
    render(<Toasts />);
    expect(TOAST_MS).toBe(4000);
    act(() => toast('Saved'));
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(screen.queryByText('Saved')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('gives action toasts longer, and honours an explicit duration', () => {
    render(<Toasts />);
    const onClick = vi.fn();
    act(() => toast('Removed', { action: { label: 'Undo', onClick } }));
    act(() => toast('Quick', { duration: 100 }));
    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByText('Quick')).toBeNull();
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS - 1000));
    expect(screen.queryByText('Removed')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Removed')).toBeNull();
  });

  it('shows an artwork thumbnail when given one (decorative: empty alt)', () => {
    const { container } = render(<Toasts />);
    act(() => toast('Added to Liked songs', { image: 'https://img.example/cover.jpg', action: { label: 'View', onClick: () => {} } }));
    const img = container.querySelector('.vx-snack-art') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('https://img.example/cover.jpg');
    expect(img.getAttribute('alt')).toBe('');
    // A plain toast has no thumbnail.
    act(() => toast('Saved'));
    expect(container.querySelectorAll('.vx-snack-art')).toHaveLength(1);
  });

  it('keeps at most two on screen — the oldest makes way', () => {
    render(<Toasts />);
    expect(MAX_TOASTS).toBe(2);
    act(() => {
      toast('One');
      toast('Two');
      toast('Three');
    });
    expect(screen.queryByText('One')).toBeNull();
    expect(screen.queryByText('Two')).not.toBeNull();
    expect(screen.queryByText('Three')).not.toBeNull();
    expect(useToastStore.getState().toasts).toHaveLength(2);
  });

  it('the same words twice show once (two code paths confirming one tap)', () => {
    render(<Toasts />);
    act(() => {
      toast('Added to queue');
      toast('Added to queue');
    });
    expect(screen.getAllByText('Added to queue')).toHaveLength(1);
  });

  it('pauses the timer while the pointer is over the stack and resumes on leave', () => {
    render(<Toasts />);
    act(() => toast('Hold me'));
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.pointerEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByText('Hold me')).not.toBeNull();

    fireEvent.pointerLeave(screen.getByRole('status'));
    // 3000 ms were left.
    act(() => vi.advanceTimersByTime(TOAST_MS - 1000 - 1));
    expect(screen.queryByText('Hold me')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Hold me')).toBeNull();
  });

  it('pauses while focus is inside and resumes when it leaves the stack', () => {
    render(<Toasts />);
    act(() => toast('Removed', { action: { label: 'Undo', onClick: () => {} } }));
    const undo = screen.getByRole('button', { name: 'Undo' });
    act(() => undo.focus());
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.queryByText('Removed')).not.toBeNull();
    act(() => undo.blur());
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS));
    expect(screen.queryByText('Removed')).toBeNull();
  });

  it('a toast pushed while paused waits for resume', () => {
    render(<Toasts />);
    act(() => toast('First'));
    fireEvent.pointerEnter(screen.getByRole('status'));
    act(() => toast('Second'));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByText('Second')).not.toBeNull();
    fireEvent.pointerLeave(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(screen.queryByText('First')).toBeNull();
    expect(screen.queryByText('Second')).toBeNull();
  });

  it('Escape dismisses the newest snackbar', () => {
    render(<Toasts />);
    act(() => {
      toast('Older');
      toast('Newer');
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Newer')).toBeNull();
    expect(screen.queryByText('Older')).not.toBeNull();
  });

  it('Escape belongs to an open sheet, not the snackbar behind it', () => {
    render(<Toasts />);
    const sheet = document.createElement('div');
    sheet.setAttribute('aria-modal', 'true');
    document.body.appendChild(sheet);
    act(() => toast('Stay'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Stay')).not.toBeNull();
    sheet.remove();
  });

  it('a downward swipe dismisses; a short drag springs back', () => {
    // jsdom has no PointerEvent: without one, fireEvent drops clientY.
    if (typeof window.PointerEvent === 'undefined') {
      class PointerEventShim extends MouseEvent {
        pointerType: string;
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerType = init.pointerType ?? 'mouse';
          this.pointerId = init.pointerId ?? 1;
        }
      }
      vi.stubGlobal('PointerEvent', PointerEventShim);
    }
    const { container } = render(<Toasts />);
    act(() => toast('Swipe me'));
    const snack = container.querySelector('.vx-snack') as HTMLElement;
    fireEvent.pointerDown(snack, { clientY: 100, pointerType: 'touch' });
    fireEvent.pointerMove(snack, { clientY: 115, pointerType: 'touch' });
    fireEvent.pointerUp(snack, { clientY: 115, pointerType: 'touch' });
    expect(screen.queryByText('Swipe me')).not.toBeNull();
    expect(snack.style.transform).toBe('');

    fireEvent.pointerDown(snack, { clientY: 100, pointerType: 'touch' });
    fireEvent.pointerMove(snack, { clientY: 160, pointerType: 'touch' });
    fireEvent.pointerUp(snack, { clientY: 160, pointerType: 'touch' });
    expect(screen.queryByText('Swipe me')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('with motion allowed, a dismissed snackbar sinks away, hidden from assistive tech, then unmounts', () => {
    document.documentElement.classList.remove('reduce-motion');
    const { container } = render(<Toasts />);
    act(() => toast('Bye'));
    act(() => vi.advanceTimersByTime(TOAST_MS));
    const leaving = container.querySelector('.vx-snack.is-leaving');
    expect(leaving).not.toBeNull();
    expect(leaving?.getAttribute('aria-hidden')).toBe('true');
    act(() => vi.advanceTimersByTime(SNACK_EXIT_MS));
    expect(container.querySelector('.vx-snack')).toBeNull();
  });

  it('a "View" action reaches the router through the mounted host', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<p>home page</p>} />
          <Route path="/queue" element={<p>queue page</p>} />
        </Routes>
        <Toasts />
      </MemoryRouter>,
    );
    act(() => toast('Added to queue', { action: { label: 'View', onClick: () => toastNavigate('/queue') } }));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.queryByText('queue page')).not.toBeNull();
  });
});
