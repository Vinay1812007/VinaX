// @vitest-environment jsdom
/**
 * Recent searches on the empty Search page. Pins: pinned searches lead and
 * say so; pin and remove are labelled toggles / buttons with 44px pads;
 * "Clear all" is reachable; a long history folds after six rows but never
 * hides a pinned search; Indic queries render whole.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RecentSearches } from './RecentSearches';

afterEach(cleanup);

const ordered = ['మనసే మౌనం', 'kiran varma', '90s hits', 'arijit', 'lofi', 'road trip', 'devotional', 'chill'];

function mount(over: Partial<Parameters<typeof RecentSearches>[0]> = {}) {
  const props = {
    ordered,
    pinned: ['మనసే మౌనం'],
    onOpen: vi.fn(),
    onTogglePin: vi.fn(),
    onRemove: vi.fn(),
    onClear: vi.fn(),
    ...over,
  };
  render(<RecentSearches {...props} />);
  return props;
}

describe('<RecentSearches />', () => {
  it('leads with the pinned search and marks it', () => {
    mount();
    const list = screen.getByRole('list');
    const first = within(list).getAllByRole('listitem')[0];
    expect(first.textContent).toContain('మనసే మౌనం');
    expect(first.textContent).toContain('Pinned');
    const pin = screen.getByRole('button', { name: 'Unpin మనసే మౌనం' });
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    expect(pin.className).toContain('after:-inset-1');
  });

  it('opens, pins, removes and clears through the callbacks', () => {
    const props = mount();
    fireEvent.click(screen.getByText('kiran varma'));
    expect(props.onOpen).toHaveBeenCalledWith('kiran varma');
    fireEvent.click(screen.getByRole('button', { name: 'Pin kiran varma' }));
    expect(props.onTogglePin).toHaveBeenCalledWith('kiran varma', false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove kiran varma' }));
    expect(props.onRemove).toHaveBeenCalledWith('kiran varma');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('folds a long history after six rows and expands on request', () => {
    mount();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    const more = screen.getByRole('button', { name: 'Show all 8' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('never folds away a pinned search', () => {
    const pinned = ordered.slice(0, 7);
    mount({ pinned });
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });
});
