// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Chip } from './Chip';

afterEach(cleanup);

describe('<Chip />', () => {
  it('is a medium control with a hit-area pad, so the touch target stays at 44px', () => {
    render(<Chip active>Songs</Chip>);
    const chip = screen.getByRole('button', { name: 'Songs' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    // 36px to look at …
    expect(chip.className).toContain('min-h-[36px]');
    // … and a pseudo-element that extends the hit box 4px above and below (36 + 8 = 44).
    // 7.0.1 shipped the smaller chip WITHOUT this pad; this assertion is why that cannot recur.
    expect(chip.className).toContain('relative');
    expect(chip.className).toContain('after:absolute');
    expect(chip.className).toContain('after:-inset-y-1');
  });
});
