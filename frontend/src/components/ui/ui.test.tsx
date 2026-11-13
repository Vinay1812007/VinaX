// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, IconButton, Slider, Switch, Tabs } from '.';

afterEach(cleanup);

describe('design system v2 primitives', () => {
  it('Button: never submits by accident, and a busy button is blocked and announced', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.className).toContain('vx-btn--primary');
    rerender(<Button busy onClick={onClick}>Save</Button>);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('IconButton: named by its label and announces a toggle', () => {
    render(<IconButton label="Like" pressed><svg /></IconButton>);
    const btn = screen.getByRole('button', { name: 'Like' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('Switch: a named switch; the row and the switch each toggle once', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Crossfade" description="Blend songs." />);
    const sw = screen.getByRole('switch', { name: 'Crossfade' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText('Blend songs.'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('Switch: a disabled switch does not change', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Hi-fi" disabled />);
    fireEvent.click(screen.getByText('Hi-fi'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Slider: labelled, reports numbers, and reads the formatted value out', () => {
    const onChange = vi.fn();
    render(<Slider label="Volume" value={40} onChange={onChange} format={(v) => `${v}%`} />);
    const input = screen.getByRole('slider', { name: 'Volume' });
    expect(input.getAttribute('aria-valuetext')).toBe('40%');
    fireEvent.change(input, { target: { value: '55' } });
    expect(onChange).toHaveBeenCalledWith(55);
  });

  it('Tabs: one tab in the tab order; arrows, Home and End move and wrap', () => {
    const onChange = vi.fn();
    const items = [{ id: 'a', label: 'All' }, { id: 'b', label: 'Songs' }, { id: 'c', label: 'Albums' }] as const;
    render(<Tabs label="Library" items={items} value="a" onChange={onChange} />);
    const tabs = screen.getAllByRole('tab');
    expect(screen.getByRole('tablist', { name: 'Library' })).toBeTruthy();
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.click(tabs[1]);
    expect(onChange).toHaveBeenLastCalledWith('b');
  });
});
