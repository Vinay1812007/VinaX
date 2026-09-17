// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Shelf } from './Shelf';

afterEach(cleanup);

/** jsdom has no layout — give the rail a geometry. */
function shape(rail: HTMLElement, g: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
  Object.defineProperty(rail, 'scrollWidth', { configurable: true, value: g.scrollWidth });
  Object.defineProperty(rail, 'clientWidth', { configurable: true, value: g.clientWidth });
  Object.defineProperty(rail, 'scrollLeft', { configurable: true, writable: true, value: g.scrollLeft });
}

function renderShelf() {
  const utils = render(
    <MemoryRouter>
      <Shelf title="Trending">
        <div>one</div>
        <div>two</div>
      </Shelf>
    </MemoryRouter>,
  );
  const rail = utils.container.querySelector('.vx-media-rail') as HTMLElement;
  return { ...utils, rail };
}

describe('Shelf desktop paging', () => {
  it('shows no paging buttons when the rail does not overflow', () => {
    renderShelf();
    expect(screen.queryByRole('button', { name: /Scroll Trending/ })).toBeNull();
  });

  it('pages by 80% of the rail and disables the button at each end', () => {
    const { rail } = renderShelf();
    shape(rail, { scrollWidth: 2000, clientWidth: 500, scrollLeft: 0 });
    const scrollBy = vi.fn();
    rail.scrollBy = scrollBy as unknown as typeof rail.scrollBy;
    act(() => {
      fireEvent.scroll(rail);
    });

    const back = screen.getByRole('button', { name: 'Scroll Trending back' }) as HTMLButtonElement;
    const forward = screen.getByRole('button', { name: 'Scroll Trending forward' }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(false);

    fireEvent.click(forward);
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 400 }));

    rail.scrollLeft = 1500;
    act(() => {
      fireEvent.scroll(rail);
    });
    expect(back.disabled).toBe(false);
    expect(forward.disabled).toBe(true);
    fireEvent.click(back);
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: -400 }));
  });

  it('removes its listeners on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderShelf();
    unmount();
    expect(remove.mock.calls.some(([type]) => type === 'resize')).toBe(true);
    remove.mockRestore();
  });
});
