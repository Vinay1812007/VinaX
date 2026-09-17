// @vitest-environment jsdom
import { memo } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { occurrenceKeys, VirtualChunks } from './VirtualChunks';

afterEach(cleanup);

const renders: Record<string, number> = {};
const Row = memo(function Row({ id }: { id: string }) {
  renders[id] = (renders[id] ?? 0) + 1;
  return <button type="button">{id}</button>;
});
const renderItem = (id: string) => <Row id={id} />;
const keyOf = (id: string) => id;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `row-${i}`);

describe('<VirtualChunks />', () => {
  it('renders a short list bare — no wrappers', () => {
    const { container } = render(<div data-testid="list"><VirtualChunks items={ids(5)} keyOf={keyOf} renderItem={renderItem} rowHeight={50} /></div>);
    expect(container.querySelectorAll('.cv-auto')).toHaveLength(0);
    expect(screen.getByTestId('list').children).toHaveLength(5);
  });

  it('groups a long list into content-visibility chunks with a height estimate, keeping every row in DOM order', () => {
    const { container } = render(<VirtualChunks items={ids(45)} keyOf={keyOf} renderItem={renderItem} rowHeight={50} chunkClassName="space-y-2" />);
    const chunks = Array.from(container.querySelectorAll<HTMLElement>('.cv-auto'));
    expect(chunks.map((c) => c.children.length)).toEqual([20, 20, 5]);
    expect(chunks.every((c) => c.getAttribute('role') === 'presentation')).toBe(true);
    expect(chunks[0].className).toContain('space-y-2');
    expect(chunks[0].style.getPropertyValue('contain-intrinsic-size')).toBe('auto 0px auto 1000px');
    expect(chunks[2].style.getPropertyValue('contain-intrinsic-size')).toBe('auto 0px auto 250px');
    // Nothing is dropped or reordered: keyboard / reading order is the list order.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(ids(45));
  });

  it('re-renders only the chunk whose rows changed', () => {
    const items = ids(45);
    const { rerender } = render(<VirtualChunks items={items} keyOf={keyOf} renderItem={renderItem} rowHeight={50} />);
    for (const k of Object.keys(renders)) delete renders[k];
    const next = [...items];
    next[44] = 'row-new';
    rerender(<VirtualChunks items={next} keyOf={keyOf} renderItem={renderItem} rowHeight={50} />);
    expect(Object.keys(renders)).toEqual(['row-new']);
  });
});

describe('occurrenceKeys', () => {
  it('keys repeats by occurrence, never by position', () => {
    expect(occurrenceKeys(['a', 'b', 'a', 'a'])).toEqual(['a', 'b', 'a#1', 'a#2']);
    // Removing an unrelated row does not change anyone else's key.
    expect(occurrenceKeys(['a', 'a', 'a'])).toEqual(['a', 'a#1', 'a#2']);
  });
});
