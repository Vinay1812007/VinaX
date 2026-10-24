// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEMPLATE_OPTIONS } from '@/constants/templates';
import { TemplatePicker } from './TemplatePicker';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('reduce-motion');
  delete (document as unknown as Record<string, unknown>).startViewTransition;
  delete document.documentElement.dataset.template;
});

describe('TemplatePicker', () => {
  it('offers the six styles as one radio group with the chosen one checked', () => {
    render(<TemplatePicker value="lumen" onChange={() => undefined} />);
    const group = screen.getByRole('radiogroup', { name: 'App style' });
    const radios = screen.getAllByRole('radio');
    expect(group).toBeTruthy();
    expect(radios).toHaveLength(TEMPLATE_OPTIONS.length);
    expect(screen.getByRole('radio', { name: /Lumen/ }).getAttribute('aria-checked')).toBe('true');
    // Roving tab index: only the chosen style is in the tab order.
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it('chooses on click, and the arrow keys move the choice and wrap', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TemplatePicker value="lumen" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Harbour/ }));
    expect(onChange).toHaveBeenLastCalledWith('harbour');
    fireEvent.keyDown(screen.getByRole('radio', { name: /Lumen/ }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('onyx');
    rerender(<TemplatePicker value="onyx" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /Onyx/ }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('lumen');
    fireEvent.keyDown(screen.getByRole('radio', { name: /Onyx/ }), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('lumen');
  });

  it('does nothing when the chosen style is picked again', () => {
    const onChange = vi.fn();
    render(<TemplatePicker value="verdant" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Verdant/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('cross-fades through a view transition where there is one, and skips it under reduced motion', () => {
    const start = vi.fn((cb: () => void) => cb());
    (document as unknown as Record<string, unknown>).startViewTransition = start;
    const onChange = vi.fn();
    render(<TemplatePicker value="lumen" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Monsoon/ }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.template).toBe('monsoon');
    expect(onChange).toHaveBeenLastCalledWith('monsoon');
    document.documentElement.classList.add('reduce-motion');
    fireEvent.click(screen.getByRole('radio', { name: /Onyx/ }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('onyx');
  });

  it('says what the chosen style changes', () => {
    render(<TemplatePicker value="onyx" onChange={() => undefined} />);
    expect(screen.getByText(/True black/)).toBeTruthy();
  });
});
