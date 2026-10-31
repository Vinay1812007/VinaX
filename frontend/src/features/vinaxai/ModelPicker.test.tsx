// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModelPicker } from './ModelPicker';
import type { PickerModel } from './types';

afterEach(cleanup);

const m = (id: string, name: string, group: PickerModel['group'], over: Partial<PickerModel> = {}): PickerModel => ({
  id, name, provider: 'Groq', group, description: 'desc', flags: { vision: false, web: false, thinking: true, code: false }, available: true, ...over,
});
const MODELS = [
  m('groq:a', 'GPT-OSS 120B', 'balanced'),
  m('groq:b', 'Qwen', 'fast', { available: false, reason: 'busy' }),
  m('nv:c', 'Super VL', 'vision', { available: false, reason: 'not_configured', flags: { vision: true, web: false, thinking: false, code: false } }),
];

describe('<ModelPicker />', () => {
  it('lists Auto first, then the groups; unavailable models are disabled with their reason', () => {
    render(<ModelPicker models={MODELS} value="auto" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    const opts = screen.getAllByRole('option');
    expect(opts[0].textContent).toContain('Auto');
    expect(opts[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Balanced', 'Fast', 'Vision']);
    const qwen = opts.find((o) => o.textContent?.includes('Qwen'))!;
    expect(qwen.getAttribute('aria-disabled')).toBe('true');
    expect(qwen.textContent).toContain('Busy right now');
    const vl = opts.find((o) => o.textContent?.includes('Super VL'))!;
    expect(vl.textContent).toContain('Not available');
    expect(vl.textContent).toContain('Vision');
  });

  it('a disabled model cannot be chosen; an available one can', () => {
    const onChange = vi.fn();
    render(<ModelPicker models={MODELS} value="auto" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    fireEvent.click(screen.getAllByRole('option').find((o) => o.textContent?.includes('Qwen'))!);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('option').find((o) => o.textContent?.includes('GPT-OSS'))!);
    expect(onChange).toHaveBeenCalledWith('groq:a');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the chosen model and closes on Escape', () => {
    render(<ModelPicker models={MODELS} value="groq:a" onChange={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Model: GPT-OSS 120B' });
    fireEvent.click(btn);
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
