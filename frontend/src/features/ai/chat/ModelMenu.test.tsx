// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ModelMenu } from './ModelMenu';
import type { ModelChoice, Provider } from './types';

const PROVIDERS: Provider[] = [
  {
    id: 'nvidia',
    label: 'NVIDIA',
    configured: true,
    models: [
      { id: 'lab/alpha-70b', name: 'Alpha 70B', maker: 'Lab One', context: 131072, vision: false },
      { id: 'lab/alpha-11b-vision', name: 'Alpha 11B Vision', maker: 'Lab One', context: 8192, vision: true },
    ],
  },
  { id: 'openrouter', label: 'OpenRouter', configured: true, models: [{ id: 'maker/big:free', name: 'Big Model', maker: 'Maker Two', context: 1_000_000, vision: false }] },
  { id: 'groq', label: 'Groq', configured: true, models: [{ id: 'small-8b', name: 'Small 8B', maker: null, context: 8192, vision: false }] },
  { id: 'gemini', label: 'Gemini', configured: false, models: [] },
];

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const mount = (over: Partial<Parameters<typeof ModelMenu>[0]> = {}) => {
  const onPick = vi.fn<(c: ModelChoice) => void>();
  const onClose = vi.fn();
  render(
    <ModelMenu
      state="ready"
      providers={PROVIDERS}
      current={{ mode: 'auto' }}
      recents={[]}
      onPick={onPick}
      onClose={onClose}
      onRetry={vi.fn()}
      {...over}
    />,
  );
  return { onPick, onClose, search: screen.getByRole('combobox', { name: 'Search models' }) };
};

describe('ModelMenu', () => {
  it('renders Auto, then four provider sections — logo, name and count — with every model under its original name', () => {
    mount();
    const list = screen.getByRole('listbox', { name: 'Choose model' });
    const groups = within(list).getAllByRole('group');
    expect(groups).toHaveLength(5);
    expect(groups[0].getAttribute('aria-label')).toBe('Auto');
    const names = groups.slice(1).map((g) => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent);
    expect(names).toEqual(['NVIDIA', 'OpenRouter', 'Groq', 'Gemini']);
    expect(groups.slice(1).map((g) => g.querySelector('.ai-model-count')?.textContent ?? null)).toEqual(['2', '1', '1', null]);
    // Each provider heading carries that provider's logo (decorative: the name is beside it).
    const logos = groups.slice(1).map((g) => g.querySelector('.ai-model-heading svg'));
    expect(logos.map((l) => l?.getAttribute('data-provider'))).toEqual(['nvidia', 'openrouter', 'groq', 'gemini']);
    expect(logos.every((l) => l?.getAttribute('aria-hidden') === 'true')).toBe(true);

    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.querySelector('.ai-model-label')?.textContent)).toEqual(['Auto', 'Alpha 70B', 'Alpha 11B Vision', 'Big Model', 'Small 8B']);
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.textContent)).toEqual([expect.stringContaining('Auto')]);
    expect(options[0].textContent).toContain('Picks the best model for each question');
    expect(options[1].textContent).toContain('Lab One · 128K context');
    // The Vision tag only where the model reads images.
    expect(within(options[2]).getByText('Vision', { selector: '.ai-badge' })).toBeTruthy();
    expect(options[1].querySelector('.ai-badge')).toBeNull();
    // The provider without a key is one quiet line, never hidden and never invented.
    expect(within(groups[4]).getByText('Not available right now')).toBeTruthy();
  });

  it('moves with the arrow keys, Home and End, and picks with Enter', () => {
    const { onPick, search } = mount();
    const activeText = (): string => document.getElementById(search.getAttribute('aria-activedescendant') ?? '')?.textContent ?? '';
    expect(activeText()).toContain('Auto');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(activeText()).toContain('Alpha 70B');
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(activeText()).toContain('Small 8B');
    fireEvent.keyDown(search, { key: 'Home' });
    expect(activeText()).toContain('Auto');
    fireEvent.keyDown(search, { key: 'End' });
    expect(activeText()).toContain('Small 8B');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ mode: 'model', provider: 'groq', model: 'small-8b', name: 'Small 8B' });
  });

  it('searches name, maker and provider, and closes on Escape without leaking the key', () => {
    const { onPick, onClose, search } = mount();
    fireEvent.change(search, { target: { value: 'maker two' } });
    expect(screen.getAllByRole('option').map((o) => o.querySelector('.ai-model-label')?.textContent)).toEqual(['Big Model']);
    fireEvent.change(search, { target: { value: 'groq' } });
    expect(screen.getAllByRole('option').map((o) => o.querySelector('.ai-model-label')?.textContent)).toEqual(['Small 8B']);
    fireEvent.change(search, { target: { value: '11b' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ mode: 'model', provider: 'nvidia', model: 'lab/alpha-11b-vision', name: 'Alpha 11B Vision' });
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toContain('No model matches');
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    fireEvent.keyDown(search, { key: 'Escape' });
    document.removeEventListener('keydown', outer);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('shows recents with their provider logo, and checks nothing when no choice is in use', () => {
    mount({ current: null, recents: [{ mode: 'model', provider: 'openrouter', model: 'maker/big:free', name: 'Big Model' }] });
    const recent = screen.getByRole('group', { name: 'Recently used' });
    const row = within(recent).getByRole('option');
    expect(row.querySelector('svg')?.getAttribute('data-provider')).toBe('openrouter');
    expect(row.textContent).toContain('OpenRouter · Maker Two');
    expect(screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(0);
  });

  it('picks with a click, and offers a retry when the list failed to load', () => {
    const onRetry = vi.fn();
    const { onPick } = mount({ state: 'failed', providers: [], onRetry, current: { mode: 'model', provider: 'groq', model: 'small-8b' } });
    fireEvent.click(screen.getByText('Auto'));
    expect(onPick).toHaveBeenCalledWith({ mode: 'auto' });
    expect(screen.getAllByRole('button', { name: /tap to retry/i })).toHaveLength(4);
    fireEvent.click(screen.getAllByRole('button', { name: /tap to retry/i })[0]);
    expect(onRetry).toHaveBeenCalled();
  });
});
