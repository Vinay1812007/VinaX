import { describe, expect, it } from 'vitest';
import { describeDevice } from './device';

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidApp: 'Mozilla/5.0 (Linux; Android 13; SM-A546E Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
};

describe('describeDevice', () => {
  it('names the Android app and Android browsers apart', () => {
    expect(describeDevice(UA.androidApp, true).label).toBe('VinaX Android app · Android 13');
    const web = describeDevice(UA.androidChrome, false);
    expect(web).toMatchObject({ os: 'android', browser: 'Chrome', form: 'phone', app: false, label: 'Android 14 · Chrome' });
  });
  it('tells iPhone, iPad and Mac apart (an iPad reports a Mac agent)', () => {
    expect(describeDevice(UA.iphone, false).label).toBe('iPhone · Safari');
    expect(describeDevice(UA.ipad, false, 5)).toMatchObject({ os: 'ipados', form: 'tablet', label: 'iPad · Safari' });
    expect(describeDevice(UA.mac, false, 0)).toMatchObject({ os: 'macos', form: 'desktop', label: 'Mac · Chrome' });
  });
  it('names Windows, Edge, Linux and Firefox', () => {
    expect(describeDevice(UA.windowsEdge, false).label).toBe('Windows · Edge');
    expect(describeDevice(UA.linuxFirefox, false).label).toBe('Linux · Firefox');
  });
  it('never throws on an empty agent', () => {
    expect(describeDevice('', false)).toMatchObject({ os: 'unknown', label: 'Unknown device' });
  });
});
