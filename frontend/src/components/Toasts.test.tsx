// @vitest-environment jsdom
/**
 * Toast stack contract:
 *   - the polite live region exists BEFORE the first toast (a region that
 *     mounts with its message is not announced), and toasts carry no role;
 *   - hovering / focusing the stack holds the dismiss timers, leaving resumes
 *     them with the time that was left;
 *   - toast(message, opts) keeps its original signature and defaults.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toasts } from './Toasts';
import { toast, useToastStore } from '@/store/toastStore';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => {
    for (const t of useToastStore.getState().toasts) useToastStore.getState().dismiss(t.id);
    useToastStore.getState().resume();
  });
  cleanup();
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

  it('auto-dismisses after the default duration (API unchanged)', () => {
    render(<Toasts />);
    act(() => toast('Saved'));
    act(() => vi.advanceTimersByTime(2399));
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
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText('Removed')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Removed')).toBeNull();
  });

  it('pauses the timer while the pointer is over the stack and resumes on leave', () => {
    render(<Toasts />);
    act(() => toast('Hold me'));
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.pointerEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByText('Hold me')).not.toBeNull();

    fireEvent.pointerLeave(screen.getByRole('status'));
    // 1400 ms were left.
    act(() => vi.advanceTimersByTime(1399));
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
    act(() => vi.advanceTimersByTime(5000));
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
    act(() => vi.advanceTimersByTime(2400));
    expect(screen.queryByText('First')).toBeNull();
    expect(screen.queryByText('Second')).toBeNull();
  });
});
