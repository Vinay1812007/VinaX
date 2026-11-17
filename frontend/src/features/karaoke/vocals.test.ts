import { describe, expect, it } from 'vitest';
import { VOCALS_HINT, vocalsBlocked } from './vocals';

const ok = { ios: false, casting: false, webAudio: true, bypassed: false };

describe('vocalsBlocked', () => {
  it('is null when the chain can run', () => {
    expect(vocalsBlocked(ok)).toBeNull();
  });

  it('names each place it cannot work, in one line', () => {
    expect(vocalsBlocked({ ...ok, ios: true })).toMatch(/iPhone/);
    expect(vocalsBlocked({ ...ok, casting: true })).toMatch(/casting/);
    expect(vocalsBlocked({ ...ok, webAudio: false })).toMatch(/browser/);
    expect(vocalsBlocked({ ...ok, bypassed: true })).toMatch(/This song/);
    for (const c of [{ ios: true }, { casting: true }, { webAudio: false }, { bypassed: true }]) {
      expect(vocalsBlocked({ ...ok, ...c })).not.toMatch(/\n/);
    }
  });

  it('iPhone Safari wins over the rest (the chain never runs there)', () => {
    expect(vocalsBlocked({ ios: true, casting: true, webAudio: true, bypassed: true })).toMatch(/iPhone/);
  });

  it('the hint warns about mono songs', () => {
    expect(VOCALS_HINT).toMatch(/mono/);
  });
});
