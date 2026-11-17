// @vitest-environment jsdom
/**
 * VinaX AI's now-playing pill: "Ask about this song" fills the composer with
 * a question about the song playing (it never sends); without a song there
 * is no pill.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Song } from '@/types';
import { makeSong } from '@/__fixtures__/songs';

let current: Song | null = null;
const player = { isPlaying: true, togglePlay: vi.fn() };
vi.mock('@/store/playerStore', () => ({
  useCurrentSong: () => current,
  usePlayerStore: (pick: (s: typeof player) => unknown) => pick(player),
}));

const { askAboutSong, NowPlayingPill } = await import('./NowPlayingPill');

afterEach(() => {
  cleanup();
  current = null;
});

describe('Ask about this song', () => {
  it('names the song and up to two artists, or the subtitle, or just the title', () => {
    expect(askAboutSong(makeSong('1', { title: 'Samajavaragamana', artist: 'Sid Sriram' }))).toBe('Tell me about Samajavaragamana by Sid Sriram');
    expect(askAboutSong({ title: 'Duet', subtitle: '', artists: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] })).toBe('Tell me about Duet by A, B');
    expect(askAboutSong({ title: 'Folk', subtitle: 'Various', artists: [] })).toBe('Tell me about Folk by Various');
    expect(askAboutSong({ title: ' Hum ', subtitle: ' ', artists: [] })).toBe('Tell me about Hum');
  });

  it('hands the question to the composer when tapped, and the pill shows only while a song is loaded', () => {
    const onAsk = vi.fn();
    const { rerender } = render(<MemoryRouter><NowPlayingPill onAsk={onAsk} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Ask about this song' })).toBeNull();
    current = makeSong('1', { title: 'Kesariya', artist: 'Arijit Singh' });
    rerender(<MemoryRouter><NowPlayingPill onAsk={onAsk} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this song' }));
    expect(onAsk).toHaveBeenCalledWith('Tell me about Kesariya by Arijit Singh');
    expect(player.togglePlay).not.toHaveBeenCalled();
    rerender(<MemoryRouter><NowPlayingPill /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Ask about this song' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });
});
