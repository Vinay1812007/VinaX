// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ModelMenu } from './ModelMenu';
import { MODES } from './models';
import type { CatalogGroup, ModelChoice } from './types';

const GROUPS: CatalogGroup[] = [
  {
    id: 'grq',
    label: 'VinaX GRQ ALL',
    hint: '',
    configured: true,
    models: [
      { id: 'vendor/agentic', label: 'agentic', context: 131072, agent: true },
      { id: 'vendor/plain-8b', label: 'plain-8b', context: 8192, agent: false },
    ],
  },
  { id: 'opr', label: 'VinaX OPR ALL', hint: '', configured: false, models: [] },
];

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const mount = (over: Partial<Parameters<typeof ModelMenu>[0]> = {}) => {
  const onPick = vi.fn<(c: ModelChoice) => void>();
  const onClose = vi.fn();
  render(
    <ModelMenu state="ready" groups={GROUPS} current={{ mode: 'muse' }} recents={[]} agentOnly={false} onPick={onPick} onClose={onClose} onRetry={vi.fn()} {...over} />,
  );
  return { onPick, onClose, search: screen.getByRole('combobox', { name: 'Search models' }) };
};

describe('ModelMenu', () => {
  it('is a listbox of every engine and every catalogue model, with the one in use checked', () => {
    mount();
    const list = screen.getByRole('listbox', { name: 'Choose model' });
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(MODES.length + 2);
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.textContent)).toEqual([expect.stringContaining('Balanced')]);
    expect(within(list).getAllByRole('group').map((g) => g.getAttribute('aria-labelledby')).every(Boolean)).toBe(true);
    const agentic = options.find((o) => o.textContent?.includes('agentic'));
    expect(agentic?.textContent).toContain('Agent');
    expect(agentic?.textContent).toContain('128K');
    // The unconfigured catalogue is one quiet line, never an invented list.
    expect(screen.getByText('Not available right now')).toBeTruthy();
  });

  it('moves with the arrow keys, Home and End, and picks with Enter', () => {
    const { onPick, search } = mount();
    const activeText = (): string => document.getElementById(search.getAttribute('aria-activedescendant') ?? '')?.textContent ?? '';
    expect(activeText()).toContain('Balanced');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(activeText()).toContain('Fast');
    fireEvent.keyDown(search, { key: 'Home' });
    expect(activeText()).toContain('Auto');
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(activeText()).toContain('plain-8b');
    fireEvent.keyDown(search, { key: 'End' });
    expect(activeText()).toContain('plain-8b');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ mode: 'scholar', model: 'vendor/plain-8b' });
  });

  it('filters as you type and closes on Escape without leaking the key', () => {
    const { onPick, onClose, search } = mount();
    fireEvent.change(search, { target: { value: 'agentic' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ mode: 'scholar', model: 'vendor/agentic' });
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

  it('in Agent mode offers agent-capable models only', () => {
    mount({ agentOnly: true, current: { mode: 'scholar', model: 'vendor/agentic' } });
    const options = within(screen.getByRole('listbox', { name: 'Choose agent model' })).getAllByRole('option');
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['true']);
    expect(options[0].textContent).toContain('agentic');
  });

  it('picks with a click, and offers a retry when the catalogue failed to load', () => {
    const onRetry = vi.fn();
    const { onPick } = mount({ state: 'failed', groups: [], onRetry });
    fireEvent.click(screen.getByText('Deep'));
    expect(onPick).toHaveBeenCalledWith({ mode: 'sage' });
    fireEvent.click(screen.getAllByRole('button', { name: /tap to retry/i })[0]);
    expect(onRetry).toHaveBeenCalled();
  });
});
