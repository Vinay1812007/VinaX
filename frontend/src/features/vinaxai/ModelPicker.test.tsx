// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { badgesOf, contextLabel, ModelPicker } from './ModelPicker';
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

  it('a locked Claude model is shown in its own group with a Locked badge and cannot be chosen', () => {
    const onChange = vi.fn();
    const claude = m('anthropic:claude-haiku-5-5', 'Claude Haiku 5.5', 'claude', { provider: 'Anthropic', available: false, reason: 'locked', locked: true });
    render(<ModelPicker models={[...MODELS, claude]} value="auto" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    expect(screen.getByText('Claude', { selector: '.vx-ai-pop-head' })).toBeTruthy();
    const opt = screen.getAllByRole('option').find((o) => o.textContent?.includes('Claude Haiku 5.5'))!;
    expect(opt.getAttribute('aria-disabled')).toBe('true');
    expect(opt.textContent).toContain('Locked: Claude is not open to this account');
    expect(badgesOf(claude)[0]).toBe('Locked');
    fireEvent.click(opt);
    expect(onChange).not.toHaveBeenCalled();
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

describe('groups and search', () => {
  const MANY = [
    ...MODELS,
    ...Array.from({ length: 10 }, (_, i) => m(`openrouter:x${i}/m:free`, `Extra ${i}`, 'more', { provider: 'OpenRouter', description: 'Meta · 131K context' })),
    m('cloudflare:a', 'Llama CF', 'cloudflare', { provider: 'Workers AI' }),
  ];

  it('lists the curated groups with their names, and the search finds a model by its group', () => {
    render(<ModelPicker models={MANY} value="auto" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    const heads = screen.getAllByRole('group').map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent);
    expect(heads).toEqual(['Balanced', 'Fast', 'Vision', 'More models', 'Cloudflare']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cloudflare' } });
    expect(screen.getAllByRole('option').map((o) => o.querySelector('.vx-ai-opt-name')?.textContent)).toEqual(['Llama CF']);
  });
});

describe('capability filters', () => {
  const caps: PickerModel[] = [
    { id: 'a', name: 'Quick', provider: 'NVIDIA', group: 'fast', description: 'fast one', flags: { vision: false, web: false, thinking: false, code: false }, available: true, kinds: ['fast'], thinkingLevels: ['standard'], contextTokens: 25_000 },
    { id: 'b', name: 'Seer', provider: 'Gemini', group: 'smart', description: 'sees', flags: { vision: true, web: false, thinking: true, code: false, pdf: true }, available: true, kinds: ['reasoning', 'vision', 'long'], thinkingLevels: ['fast', 'standard', 'extended', 'max'], contextTokens: 150_000, recommended: true },
  ];
  it('chips narrow the list by capability; context and thinking show on each model', () => {
    render(<ModelPicker models={caps} value="auto" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    const group = screen.getByRole('group', { name: 'Filter models' });
    // Only filters some model has: no Code chip here.
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['All', 'Recommended', 'Fast', 'Reasoning', 'Vision', 'Long context']);
    expect(screen.getByRole('option', { name: /Seer/ }).textContent).toContain('150K context');
    expect(screen.getByRole('option', { name: /Seer/ }).textContent).toContain('Max thinking');
    fireEvent.click(screen.getByRole('button', { name: 'Vision' }));
    expect(screen.queryByRole('option', { name: /Quick/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /^Auto/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fast' }));
    expect(screen.getByRole('option', { name: /Quick/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Seer/ })).toBeNull();
  });

  it('contextLabel and badgesOf', () => {
    expect(contextLabel(1_048_576)).toBe('1M context');
    expect(contextLabel(7_500)).toBe('8K context');
    expect(contextLabel(undefined)).toBeNull();
    expect(badgesOf(caps[1])).toEqual(['Vision', 'PDF', 'Max thinking']);
  });
});
