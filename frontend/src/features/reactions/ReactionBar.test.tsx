// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { ReactionBar } from './ReactionBar';

const song = { kind: 'song', id: 'abc123', title: 'Chuttamalle', subtitle: 'Anirudh', images: [], language: 'telugu' } as unknown as Song;

describe('1.12 — the reaction bar', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows everyone’s counts, lights yours, and moves at once on a tap', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (!init || init.method !== 'POST') return new Response(JSON.stringify({ total: 3, counts: { fire: 2, love: 1 }, mine: 'love' }), { status: 200 });
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify({ total: 3, counts: { fire: 3 }, mine: 'fire', signed_device_id_next: 'w_abcdef0123456789' }), { status: 200 });
    }));
    render(<ReactionBar song={song} />);
    const love = await screen.findByRole('button', { name: 'Love, 1, yours' });
    expect(love.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('3 reactions')).toBeTruthy();
    expect(calls[0].url).toContain('/api/reactions?song=abc123&deviceId=');
    fireEvent.click(screen.getByRole('button', { name: 'Fire, 2' }));
    // Optimistic: love drops to none, fire rises — before the Worker answers.
    expect(screen.getByRole('button', { name: 'Fire, 3, yours' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Love' })).toBeTruthy();
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toMatchObject({ song: 'abc123', emoji: 'fire', title: 'Chuttamalle', artist: 'Anirudh', language: 'telugu' });
    await waitFor(() => expect(localStorage.getItem('vinax.signed-device-id')).toContain('w_abcdef'));
  });

  it('renders nothing while the Worker cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const { container } = render(<ReactionBar song={song} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(container.innerHTML).toBe('');
  });
});
