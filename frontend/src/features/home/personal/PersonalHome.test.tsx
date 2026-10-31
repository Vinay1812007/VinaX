// @vitest-environment jsdom
/**
 * The personal block on Home: nothing when signed out or switched off; the
 * composed shelves (through the shared lens), the greeting and the note when
 * a page comes; nothing when the server has no page (204) or fails — the
 * on-device Home then shows alone.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { setLocal } from '@/services/storage/local';
import { useSettingsStore } from '@/store/settingsStore';

const fetchPersonalHome = vi.fn<() => Promise<unknown>>();
vi.mock('@/services/personal/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/personal/api')>();
  return { ...actual, fetchPersonalHome: () => fetchPersonalHome() };
});

import { PersonalHome } from './PersonalHome';

const song = (id: string, artist = `Artist ${id}`) => ({ id, title: `Song ${id}`, artist, artistId: `ar-${artist}`, artists: [{ id: `ar-${artist}`, name: artist }], album: null, albumId: null, language: 'telugu', year: 2024, duration: 200, image: 'https://img.example/500x500.jpg', facets: {} });
const page = (shelves = 2) => ({
  generatedAt: 'now', expiresAt: 'later', greeting: 'Good evening, Asha', model: 'groq:x', tasteVersion: 3, cached: false,
  shelves: Array.from({ length: shelves }, (_, i) => ({ key: `shelf-${i}`, title: `Shelf ${i}`, reason: `Because ${i}`, songs: Array.from({ length: 8 }, (_, j) => song(`${i}-${j}`)) })),
});

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <MemoryRouter><QueryClientProvider client={qc}>{children}</QueryClientProvider></MemoryRouter>;
}

describe('PersonalHome', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchPersonalHome.mockReset();
    useSettingsStore.setState({ personalEngine: true, kidMode: false, discoveryMode: 'balanced' });
  });
  afterEach(() => cleanup());

  it('renders nothing while signed out, and asks the server nothing', () => {
    const { container } = render(<Wrap><PersonalHome generation={1} /></Wrap>);
    expect(container.innerHTML).toBe('');
    expect(fetchPersonalHome).not.toHaveBeenCalled();
  });

  it('shows the composed shelves, the greeting and the note for a signed-in listener', async () => {
    setLocal(KEYS.account, { session: 'vx1.p.s', user: { name: 'Asha', email: 'a@x', picture: null, username: null } });
    fetchPersonalHome.mockResolvedValue(page());
    render(<Wrap><PersonalHome generation={1} /></Wrap>);
    expect(screen.getByText('Make me a playlist')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Shelf 0')).toBeTruthy());
    expect(screen.getByText('Shelf 1')).toBeTruthy();
    expect(screen.getByText('Because 0')).toBeTruthy();
    expect(screen.getByText('Good evening, Asha')).toBeTruthy();
    expect(screen.getByText(/Arranged for this moment by VinaX AI/)).toBeTruthy();
    expect(screen.getAllByText(/^Song 0-/).length).toBeGreaterThanOrEqual(8);
  });

  it('shows only the maker when the server has no page yet or fails', async () => {
    setLocal(KEYS.account, { session: 'vx1.p.s', user: { name: 'Asha', email: 'a@x', picture: null, username: null } });
    fetchPersonalHome.mockResolvedValue(null);
    const first = render(<Wrap><PersonalHome generation={1} /></Wrap>);
    await waitFor(() => expect(fetchPersonalHome).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Shelf/)).toBeNull();
    first.unmount();
    fetchPersonalHome.mockRejectedValue(new Error('down'));
    render(<Wrap><PersonalHome generation={1} /></Wrap>);
    await waitFor(() => expect(fetchPersonalHome).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Shelf/)).toBeNull();
    expect(screen.getByText('Make me a playlist')).toBeTruthy();
  });

  it('renders nothing in Kid mode or with the engine off', () => {
    setLocal(KEYS.account, { session: 'vx1.p.s', user: { name: 'Asha', email: 'a@x', picture: null, username: null } });
    useSettingsStore.setState({ kidMode: true });
    const { container } = render(<Wrap><PersonalHome generation={1} /></Wrap>);
    expect(container.innerHTML).toBe('');
    expect(fetchPersonalHome).not.toHaveBeenCalled();
  });
});
