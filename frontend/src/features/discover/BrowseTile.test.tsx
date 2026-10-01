// @vitest-environment jsdom
/**
 * The 9.0 browse tiles. Pins: Discover's browse grid is one navigation named
 * "Browse music" with every destination reachable; Charts carries real
 * covers only when the page has songs; a toggle tile announces its state;
 * language tiles mark their script for the browser and screen readers; the
 * mood hub tiles keep the link names the hub pages' internal links rely on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { makeSong } from '@/__fixtures__/songs';
import { DestinationGrid } from '@/components/DestinationGrid';
import { LanguageGrid } from '@/components/LanguageGrid';
import { BrowseTile, TileGlyph } from './BrowseTile';
import { HubMoodTiles } from './HubMoodTiles';

afterEach(cleanup);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('DestinationGrid (discover)', () => {
  it('is one "Browse music" navigation that reaches every destination', () => {
    inRouter(<DestinationGrid area="discover" />);
    const nav = screen.getByRole('navigation', { name: 'Browse music' });
    const hrefs = within(nav).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/charts', '/languages', '/moods', '/regions', '/movies', '/videos', '/made-for-you', '/weekly', '/ai-playlist']);
    expect(within(nav).getByRole('link', { name: /Charts/ })).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: /Ads/ })).toBeNull();
  });

  it('fans real covers on the Charts lane only when it is given songs', () => {
    const { unmount } = inRouter(<DestinationGrid area="discover" />);
    expect(screen.getByRole('link', { name: /Charts/ }).querySelectorAll('img')).toHaveLength(0);
    unmount();
    const songs = ['a', 'b', 'c', 'd'].map((id, i) => makeSong(id, { images: [{ quality: '500x500', url: `https://img.example/${i}-500x500.jpg` }] }));
    inRouter(<DestinationGrid area="discover" chartSongs={songs} />);
    const imgs = screen.getByRole('link', { name: /Charts/ }).querySelectorAll('img');
    expect(imgs).toHaveLength(3);
    imgs.forEach((img) => {
      expect(img.getAttribute('alt')).toBe('');
      expect(img.getAttribute('loading')).toBe('lazy');
    });
  });
});

describe('BrowseTile', () => {
  it('as a toggle, announces its state and reports the tap', () => {
    const onClick = vi.fn();
    inRouter(<BrowseTile title="Chill" meta="Telugu" onClick={onClick} pressed={false} visual={<TileGlyph emoji>🌙</TileGlyph>} />);
    const tile = screen.getByRole('button', { name: /Chill/ });
    expect(tile.getAttribute('aria-pressed')).toBe('false');
    expect(tile.getAttribute('type')).toBe('button');
    fireEvent.click(tile);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('as a link, keeps its accessible name when one is given', () => {
    inRouter(<BrowseTile to="/telugu-sad-songs" label="Telugu sad songs" title="Sad" meta="Telugu songs" />);
    const link = screen.getByRole('link', { name: 'Telugu sad songs' });
    expect(link.getAttribute('href')).toBe('/telugu-sad-songs');
  });
});

describe('LanguageGrid', () => {
  it('labels each hub and marks its script with the right language', () => {
    inRouter(<LanguageGrid />);
    const telugu = screen.getByRole('link', { name: 'Explore Telugu music' });
    expect(telugu.getAttribute('href')).toBe('/telugu-songs');
    expect(telugu.querySelector('[lang="te"]')?.textContent).toBe('తెలుగు');
    const urdu = screen.getByRole('link', { name: 'Explore Urdu music' });
    expect(urdu.querySelector('[lang="ur"]')?.getAttribute('dir')).toBe('rtl');
  });
});

describe('HubMoodTiles', () => {
  it('links every mood hub for the language, minus the one being shown', () => {
    inRouter(<HubMoodTiles language="telugu" exclude="romantic" />);
    expect(screen.getByRole('link', { name: 'Telugu sad songs' }).getAttribute('href')).toBe('/telugu-sad-songs');
    expect(screen.queryByRole('link', { name: 'Telugu romantic songs' })).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });
});
