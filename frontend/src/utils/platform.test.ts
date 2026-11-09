import { describe, expect, it } from 'vitest';
import { isIOSWeb } from './platform';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

describe('1.12 — iOS web detection', () => {
  it('knows an iPhone, an iPad posing as a Mac, and nothing else', () => {
    expect(isIOSWeb(IPHONE, 5, false)).toBe(true);
    expect(isIOSWeb(IPAD_AS_MAC, 5, false)).toBe(true);
    expect(isIOSWeb(IPAD_AS_MAC, 0, false)).toBe(false); // a real Mac
    expect(isIOSWeb(ANDROID, 5, false)).toBe(false);
    expect(isIOSWeb(IPHONE, 5, true)).toBe(false); // the native shell is never "web"
  });
});
