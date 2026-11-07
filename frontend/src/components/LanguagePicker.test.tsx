// @vitest-environment jsdom
/**
 * The top bar's "Music languages" picker. Pins: it starts from the pinned
 * languages; ticking does nothing until Update, which writes them all at
 * once (in tap order) and unmutes any picked muted language; Update needs at
 * least one language and a change; Escape closes without saving.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LanguagePicker from './LanguagePicker';
import { useSettingsStore } from '@/store/settingsStore';

const onClose = vi.fn();
const mount = () => render(<LanguagePicker onClose={onClose} anchor={createRef<HTMLElement>()} />);

beforeEach(() => {
  onClose.mockReset();
  useSettingsStore.setState({ pinnedLanguages: ['hindi'], mutedLanguages: ['tamil'] });
});
afterEach(cleanup);

describe('LanguagePicker', () => {
  it('starts from the pinned languages and saves only on Update', () => {
    mount();
    expect((screen.getByRole('checkbox', { name: /Hindi/ }) as HTMLInputElement).checked).toBe(true);
    const update = screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement;
    expect(update.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Telugu/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Tamil/ }));
    expect(useSettingsStore.getState().pinnedLanguages).toEqual(['hindi']);
    expect(update.disabled).toBe(false);
    fireEvent.click(update);
    expect(useSettingsStore.getState().pinnedLanguages).toEqual(['hindi', 'telugu', 'tamil']);
    expect(useSettingsStore.getState().mutedLanguages).toEqual([]);
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('needs at least one language', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect((screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Escape closes without saving', () => {
    mount();
    fireEvent.click(screen.getByRole('checkbox', { name: /Telugu/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith(true);
    expect(useSettingsStore.getState().pinnedLanguages).toEqual(['hindi']);
  });
});
