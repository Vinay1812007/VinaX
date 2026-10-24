// @vitest-environment jsdom
/** 13.5.0 — the server's text is kept only for the URL it was written for. */
import { describe, expect, it } from 'vitest';
import { captureServerPage, serverPageFor } from './serverPage';

function doc(head: string, body: string): Document {
  return new DOMParser().parseFromString(`<!doctype html><html><head>${head}</head><body><div id="root">${body}</div></body></html>`, 'text/html');
}
const CHARTS = '<main id="seo-content"><h1>Top Charts</h1><p>The most popular songs.</p></main>';

describe('captureServerPage', () => {
  it('keeps the block when the canonical names this address, with or without the trailing slash', () => {
    const d = doc('<link rel="canonical" href="https://www.vinaxmusic.online/charts/"/>', CHARTS);
    expect(captureServerPage(d, { pathname: '/charts/' })?.html).toContain('<h1>Top Charts</h1>');
    expect(serverPageFor('/charts')?.path).toBe('/charts');
    expect(serverPageFor('/charts/')).not.toBeNull();
    expect(serverPageFor('/top-songs')).toBeNull();
    expect(captureServerPage(d, { pathname: '/charts' })).not.toBeNull();
  });

  it('ignores the fallback shell: home text under another address', () => {
    const d = doc('<link rel="canonical" href="https://www.vinaxmusic.online/"/>', '<main id="seo-content"><h1>VinaX — Free Music Streaming for India</h1></main>');
    expect(captureServerPage(d, { pathname: '/library' })).toBeNull();
    expect(serverPageFor('/library')).toBeNull();
  });

  it('reads the LAST canonical (an edge hub from an older shell carries home’s first)', () => {
    const d = doc(
      '<link rel="canonical" href="https://www.vinaxmusic.online/"/><link rel="canonical" href="https://www.vinaxmusic.online/hindi-sad-songs"/>',
      '<main id="seo-content"><h1>Hindi Sad Songs</h1></main>',
    );
    expect(captureServerPage(d, { pathname: '/hindi-sad-songs' })?.html).toContain('Hindi Sad Songs');
  });

  it('keeps nothing without a block or a canonical', () => {
    expect(captureServerPage(doc('', CHARTS), { pathname: '/charts' })).toBeNull();
    expect(captureServerPage(doc('<link rel="canonical" href="/charts"/>', '<div></div>'), { pathname: '/charts' })).toBeNull();
  });
});
