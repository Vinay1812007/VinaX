// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Segmented } from './SettingsControls';
import { UI_LANGS } from '@/i18n';

afterEach(cleanup);

const options = UI_LANGS.map((l) => ({ value: l.id, label: l.label }));

describe('Segmented `cols` (the six app languages)', () => {
  it('lays the choices out in rows of `cols` and still picks a language', () => {
    const onChange = vi.fn();
    render(<Segmented label="App language" cols={3} value="en" options={options} onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'App language' });
    expect(group.classList.contains('is-grid')).toBe(true);
    expect(group.style.getPropertyValue('--seg-cols')).toBe('3');
    expect(screen.getAllByRole('radio').map((b) => b.textContent)).toEqual(['English', 'తెలుగు', 'हिन्दी', 'தமிழ்', 'ಕನ್ನಡ', 'മലയാളം']);
    fireEvent.click(screen.getByRole('radio', { name: 'ಕನ್ನಡ' }));
    expect(onChange).toHaveBeenCalledWith('kn');
  });

  it('stays one line without `cols`', () => {
    render(<Segmented label="Theme" value="a" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} onChange={() => undefined} />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group.classList.contains('is-grid')).toBe(false);
    expect(group.getAttribute('style')).toBeNull();
  });
});
