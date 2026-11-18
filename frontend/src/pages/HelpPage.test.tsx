// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/audio/engine', () => ({ audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn() }, orderedSources: () => [] }));
vi.mock('@/services/media-session', () => ({ setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn() }));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));

import HelpPage from './HelpPage';
import { useSettingsStore } from '@/store/settingsStore';
import TE from '@/i18n/help/te';
import { FAQ, GUIDES } from '@/features/help/helpContent';
import { TUTORIALS } from '@/features/tutorials/tutorials';

const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/help']}><HelpPage /></MemoryRouter>
  </QueryClientProvider>,
);

describe('Help in the app language', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })));
  });
  afterEach(() => {
    cleanup();
    act(() => useSettingsStore.setState({ uiLanguage: 'en' }));
    vi.unstubAllGlobals();
  });

  it('English shows the English guides, questions and tours', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Help & feedback', level: 1 })).toBeTruthy();
    expect(screen.getByText(GUIDES[0].title)).toBeTruthy();
    expect(screen.getByText(FAQ[0].q)).toBeTruthy();
    expect(screen.getByText(TUTORIALS[0].title)).toBeTruthy();
  });

  it('Telugu loads its Help file and shows the page, guides, questions and tours in Telugu', async () => {
    act(() => useSettingsStore.setState({ uiLanguage: 'te' }));
    mount();
    await waitFor(() => expect(screen.getByText(TE.guides[GUIDES[0].id].title)).toBeTruthy());
    expect(screen.getByRole('heading', { name: TE.ui['Help & feedback'], level: 1 })).toBeTruthy();
    expect(screen.getByText(TE.groups[GUIDES[0].group])).toBeTruthy();
    expect(screen.getByText(TE.faq[FAQ[0].id].q)).toBeTruthy();
    expect(screen.getByText(TE.tutorials[TUTORIALS[0].id].title)).toBeTruthy();
    expect(screen.queryByText(GUIDES[0].title)).toBeNull();
  });

  it('Telugu search still finds a guide by its English words', async () => {
    act(() => useSettingsStore.setState({ uiLanguage: 'te' }));
    mount();
    await waitFor(() => expect(screen.getByText(TE.guides['disco-lights'].title)).toBeTruthy());
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'flashlight' } });
    expect(screen.getByText(TE.guides['disco-lights'].title)).toBeTruthy();
    expect(screen.queryByText(TE.guides.radio.title)).toBeNull();
  });
});
