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
    render(<TemplatePicker value="aura" onChange={() => undefined} />);
    const group = screen.getByRole('radiogroup', { name: 'App style' });
    const radios = screen.getAllByRole('radio');
    expect(group).toBeTruthy();
    expect(radios).toHaveLength(TEMPLATE_OPTIONS.length);
    expect(screen.getByRole('radio', { name: /Aura/ }).getAttribute('aria-checked')).toBe('true');
    // Roving tab index: only the chosen style is in the tab order.
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it('chooses on click, and the arrow keys move the choice and wrap', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TemplatePicker value="aura" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Nocturne/ }));
    expect(onChange).toHaveBeenLastCalledWith('nocturne');
    fireEvent.keyDown(screen.getByRole('radio', { name: /Aura/ }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('vibe');
    rerender(<TemplatePicker value="vibe" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /Vibe/ }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('aura');
    fireEvent.keyDown(screen.getByRole('radio', { name: /Vibe/ }), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('aura');
  });

  it('does nothing when the chosen style is picked again', () => {
    const onChange = vi.fn();
    render(<TemplatePicker value="pulse" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Pulse/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('cross-fades through a view transition where there is one, and skips it under reduced motion', () => {
    const start = vi.fn((cb: () => void) => cb());
    (document as unknown as Record<string, unknown>).startViewTransition = start;
    const onChange = vi.fn();
    render(<TemplatePicker value="aura" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Sangam/ }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.template).toBe('sangam');
    expect(onChange).toHaveBeenLastCalledWith('sangam');
    document.documentElement.classList.add('reduce-motion');
    fireEvent.click(screen.getByRole('radio', { name: /Marquee/ }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('marquee');
  });

  it('says what the chosen style changes', () => {
    render(<TemplatePicker value="marquee" onChange={() => undefined} />);
    expect(screen.getByText(/True black/)).toBeTruthy();
  });
});
