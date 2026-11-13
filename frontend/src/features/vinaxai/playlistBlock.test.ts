import { describe, expect, it } from 'vitest';
import { parsePlaylistBlock } from './playlistBlock';

describe('2.0 — the playlist block VinaX AI writes', () => {
  it('reads the title and "Title — Artist" lines, with list markers, quotes, dashes or "by"', () => {
    const d = parsePlaylistBlock('title: Rainy drive\n1. Vennela Vaana — Deccan Echo\n- "Monsoon Letter" - Studio Marigold\nnot a song\nKadal Kaatru by Nila and the Tide\n');
    expect(d.title).toBe('Rainy drive');
    expect(d.songs).toEqual([
      { title: 'Vennela Vaana', artist: 'Deccan Echo' },
      { title: 'Monsoon Letter', artist: 'Studio Marigold' },
      { title: 'Kadal Kaatru', artist: 'Nila and the Tide' },
    ]);
  });

  it('names an untitled playlist, and finds no songs in an empty or partial block', () => {
    expect(parsePlaylistBlock('A — B').title).toBe('Playlist from VinaX AI');
    expect(parsePlaylistBlock('').songs).toEqual([]);
    expect(parsePlaylistBlock('title: Half\nVennela Va').songs).toEqual([]);
  });

  it('keeps at most 50 songs', () => {
    const many = Array.from({ length: 80 }, (_, i) => `Song ${i} — Artist ${i}`).join('\n');
    expect(parsePlaylistBlock(many).songs).toHaveLength(50);
  });
});
