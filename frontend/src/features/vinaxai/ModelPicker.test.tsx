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

describe('a long list', () => {
  const MANY = [
    ...Array.from({ length: 12 }, (_, i) => m(`groq:f${i}`, `Fast ${i}`, 'fast')),
    m('nvidia:riva', 'Riva Translate 4B', 'more', { provider: 'NVIDIA', description: 'Translates text between languages' }),
    m('openrouter:lfm', 'LFM 2.5 2.6B', 'fast', { provider: 'OpenRouter', available: false, reason: 'busy' }),
    m('openrouter:dots', 'Dots 3 Note Preview', 'more', { provider: 'OpenRouter' }),
  ];

  it('short lists have no search box', () => {
    render(<ModelPicker models={MODELS} value="auto" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('labels the More models group and searches name, provider and description', () => {
    render(<ModelPicker models={MANY} value="auto" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    expect(screen.getByText('More models')).toBeTruthy();
    const box = screen.getByRole('searchbox', { name: 'Search models' });
    fireEvent.change(box, { target: { value: 'translate' } });
    expect(screen.getAllByRole('option').map((o) => o.querySelector('.vx-ai-opt-name')?.textContent)).toEqual(['Riva Translate 4B']);
    fireEvent.change(box, { target: { value: 'openrouter' } });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toContain('zzz');
  });

  it('Enter in the search box picks the first available match', () => {
    const onChange = vi.fn();
    render(<ModelPicker models={MANY} value="auto" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    const box = screen.getByRole('searchbox', { name: 'Search models' });
    fireEvent.change(box, { target: { value: 'openrouter' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('openrouter:dots');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape in the search box closes the picker', () => {
    render(<ModelPicker models={MANY} value="auto" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Escape belongs to the overlay that has focus', () => {
  it('an Escape aimed at another dialog does not close the picker', () => {
    render(<><ModelPicker models={MODELS} value="auto" onChange={vi.fn()} /><div role="dialog"><button type="button">Other</button></div></>);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Other' }), { key: 'Escape' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(screen.getAllByRole('option')[0], { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
