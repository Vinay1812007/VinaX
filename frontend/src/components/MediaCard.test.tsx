// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaCard } from './MediaCard';
import { FALLBACK_ART } from '@/utils/images';

afterEach(cleanup);

const renderCard = (props: Partial<Parameters<typeof MediaCard>[0]>) =>
  render(
    <MemoryRouter>
      <MediaCard to="/artist/1" image="" title="Pritam Singh" {...props} />
    </MemoryRouter>,
  );

describe('MediaCard', () => {
  it('an artist with no photo shows initials on a name-picked tint, not the wave art', () => {
    const { container } = renderCard({ round: true });
    const mono = container.querySelector('.vx-media-monogram') as HTMLElement;
    expect(mono?.textContent).toBe('PS');
    expect(mono.style.getPropertyValue('--mono-h')).toMatch(/^\d+$/);
    expect(container.querySelector('img')).toBeNull();
  });

  it('an artist whose photo fails to load falls back to the monogram too', () => {
    const { container } = renderCard({ round: true, image: 'https://example.com/a.jpg' });
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('.vx-media-monogram')?.textContent).toBe('PS');
  });

  it('an album keeps the brand placeholder art', () => {
    const { container } = renderCard({ round: false, title: 'Some Album' });
    expect(container.querySelector('.vx-media-monogram')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(FALLBACK_ART);
  });
});
