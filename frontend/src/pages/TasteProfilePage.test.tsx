// @vitest-environment jsdom
/**
 * 1.15 — Taste profile shows what shapes the mixes (affinity weights, the
 * listening clock), not play counts: Most replayed and Last 7 days live on
 * Your VinaX (/stats), and the two pages link to each other.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TasteInsights } from '@/features/taste-profile/useTasteInsights';

const insights: TasteInsights = {
  topLanguages: [{ id: 'telugu', label: 'Telugu', score: 5, plays: 12 }],
  topArtists: [{ name: 'Sid Sriram', score: 4, plays: 9 }],
  mostReplayed: [{ songId: 's1', title: 'Replayed song', count: 6 }],
  hourHistogram: Array.from({ length: 24 }, (_, h) => (h === 21 ? 5 : 0)),
  totals: { plays: 20, completes: 15, skips: 4, favorites: 2, dislikes: 0 } as TasteInsights['totals'],
  completionRate: 0.8,
  skipRate: 0.2,
  newToYouShare: null,
  exploration: { mode: 'balanced', adventurous: 0.5 },
  topMoods: [],
  topGenres: [],
  confidence: 0.4,
  listeningMinutes: 70,
};

vi.mock('@/features/taste-profile/useTasteInsights', () => ({ useTasteInsights: () => ({ data: insights, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/features/location/useRegion', () => ({ useRegion: () => null }));
vi.mock('@/features/personalization/PersonalizationPreview', () => ({ PersonalizationPreview: () => null }));
vi.mock('@/features/personalization/SoftMuteList', () => ({ SoftMuteList: () => null }));

import TasteProfilePage from './TasteProfilePage';

afterEach(cleanup);

describe('TasteProfilePage', () => {
  it('keeps the mix weights and leaves play counts to Your VinaX', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TasteProfilePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'What shapes your mixes' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Languages in your mixes' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Artists in your mixes' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'When you listen' })).toBeTruthy();
    expect(screen.queryByText('Most replayed')).toBeNull();
    expect(screen.queryByText('Last 7 days')).toBeNull();
    expect(screen.queryByText('Replayed song')).toBeNull();
    expect(screen.getByRole('link', { name: 'Your plays and stats' }).getAttribute('href')).toBe('/stats');
  });
});
