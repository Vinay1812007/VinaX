import { describe, expect, it } from 'vitest';
import { shareAction } from './shareTarget';

describe('shareAction', () => {
  it('opens a shared VinaX link, on www or the apex, with chat text around it', () => {
    expect(shareAction({ text: 'Join me! https://www.vinaxmusic.online/together?code=AB12CD.' })).toEqual({ kind: 'open', path: '/together?code=AB12CD' });
    expect(shareAction({ url: 'https://vinaxmusic.online/song/kesariya-abc123' })).toEqual({ kind: 'open', path: '/song/kesariya-abc123' });
    expect(shareAction({ text: 'listen', url: 'https://www.vinaxmusic.online/p/xyz' })).toEqual({ kind: 'open', path: '/p/xyz' });
  });

  it('never opens /share again, and ignores a plain Home link', () => {
    expect(shareAction({ text: 'https://www.vinaxmusic.online/share?text=hi' })).toEqual({ kind: 'none' });
    expect(shareAction({ text: 'https://www.vinaxmusic.online/' })).toEqual({ kind: 'none' });
    expect(shareAction({ text: 'Kesariya https://www.vinaxmusic.online/share?text=x' })).toEqual({ kind: 'search', query: 'Kesariya' });
  });

  it('sends a list to Import a playlist, without links or empty lines', () => {
    const got = shareAction({ text: 'Kesariya - Arijit Singh\n\n  Srivalli — Sid Sriram \nhttps://example.com/x\n🎵\nNaatu Naatu' });
    expect(got).toEqual({ kind: 'import', text: 'Kesariya - Arijit Singh\nSrivalli — Sid Sriram\nNaatu Naatu' });
  });

  it('keeps at most 100 lines', () => {
    const text = Array.from({ length: 150 }, (_, i) => `Song ${i}`).join('\n');
    const got = shareAction({ text });
    expect(got.kind).toBe('import');
    expect(got.kind === 'import' && got.text.split('\n')).toHaveLength(100);
  });

  it('searches one line, reading "Title - Artist" as both words', () => {
    expect(shareAction({ text: 'Kesariya - Arijit Singh' })).toEqual({ kind: 'search', query: 'Kesariya Arijit Singh' });
    expect(shareAction({ text: '  Naatu   Naatu  ' })).toEqual({ kind: 'search', query: 'Naatu Naatu' });
    expect(shareAction({ text: 'x'.repeat(300) })).toEqual({ kind: 'search', query: 'x'.repeat(120) });
  });

  it('searches the name inside a JioSaavn link', () => {
    expect(shareAction({ text: 'https://www.jiosaavn.com/song/kesariya-from-brahmastra/OQMaey5hbVc' })).toEqual({ kind: 'search', query: 'kesariya from brahmastra' });
    expect(shareAction({ url: 'https://www.jiosaavn.com/album/pushpa/abc' })).toEqual({ kind: 'search', query: 'pushpa' });
  });

  it('prefers the JioSaavn name to the chat line round it, and drops other apps\' wrappers', () => {
    expect(shareAction({ text: 'Check out Kesariya on JioSaavn https://www.jiosaavn.com/song/kesariya-from-brahmastra/OQMaey5hbVc' })).toEqual({ kind: 'search', query: 'kesariya from brahmastra' });
    expect(shareAction({ text: 'Check out Kesariya by Arijit Singh on Spotify https://open.spotify.com/track/abc' })).toEqual({ kind: 'search', query: 'Kesariya Arijit Singh' });
    expect(shareAction({ text: "I'm listening to Naatu Naatu on YouTube Music." })).toEqual({ kind: 'search', query: 'Naatu Naatu' });
    expect(shareAction({ text: 'Stand by Me' })).toEqual({ kind: 'search', query: 'Stand by Me' });
  });

  it('falls back to the share title for a bare link from another app', () => {
    expect(shareAction({ title: 'Srivalli (Video Song)', text: 'https://youtu.be/abc' })).toEqual({ kind: 'search', query: 'Srivalli (Video Song)' });
    expect(shareAction({ text: 'https://open.spotify.com/track/abc?si=1' })).toEqual({ kind: 'none' });
  });

  it('does nothing with an empty share', () => {
    expect(shareAction({})).toEqual({ kind: 'none' });
    expect(shareAction({ title: ' ', text: '', url: null })).toEqual({ kind: 'none' });
    expect(shareAction({ text: '!!! ...' })).toEqual({ kind: 'none' });
  });
});
