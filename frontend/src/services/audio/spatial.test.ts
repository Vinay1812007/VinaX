// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// No real AudioContext in jsdom: only the pure parts of the spatial stage.
vi.stubGlobal('AudioContext', undefined);

const { speakerPositions, spatialMix, SPATIAL_ANGLE, SPATIAL_ROOM } = await import('./effects');

let native = false;
let available = false;
const caps = vi.fn();
const openDolby = vi.fn();
vi.mock('@/services/native', () => ({ isNativePlatform: () => native }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isPluginAvailable: () => available },
  registerPlugin: () => ({ caps: (...a: unknown[]) => caps(...a), openDolby: (...a: unknown[]) => openDolby(...a) }),
}));
const soundCaps = await import('./soundCaps');

describe('1.19.2 spatial audio stage', () => {
  it('puts the two virtual speakers in front, mirrored left and right', () => {
    const { left, right } = speakerPositions();
    expect(left[0]).toBeLessThan(0);
    expect(right[0]).toBe(-left[0]);
    expect(left[2]).toBeLessThan(0); // in front: the listener faces -z
    expect(left[2]).toBe(right[2]);
    expect(Math.hypot(...left)).toBeCloseTo(1, 2);
    expect(Math.atan2(right[0], -right[2]) * (180 / Math.PI)).toBeCloseTo(SPATIAL_ANGLE, 0);
  });

  it('off passes the dry signal only; on is the speakers plus a quiet room', () => {
    expect(spatialMix(false)).toEqual({ dry: 1, wet: 0, room: 0 });
    expect(spatialMix(true)).toEqual({ dry: 0, wet: 1, room: SPATIAL_ROOM });
    expect(SPATIAL_ROOM).toBeLessThan(0.5);
  });
});

describe('1.19.2 sound capabilities', () => {
  beforeEach(() => {
    soundCaps.resetSoundCapsForTest();
    native = false;
    available = false;
    caps.mockReset();
    openDolby.mockReset();
  });

  it('a browser offers spatial audio only when it says it can render spatially', async () => {
    const yes = { decodingInfo: vi.fn(async (_config: unknown) => ({ supported: true })) };
    const no = { decodingInfo: vi.fn(async () => ({ supported: false })) };
    const broken = { decodingInfo: vi.fn(async () => { throw new TypeError('bad config'); }) };
    expect(await soundCaps.webSpatial(yes)).toBe(true);
    expect(yes.decodingInfo.mock.calls[0][0]).toMatchObject({ audio: { spatialRendering: true } });
    expect(await soundCaps.webSpatial(no)).toBe(false);
    expect(await soundCaps.webSpatial(broken)).toBe(false);
    expect(await soundCaps.webSpatial(undefined)).toBe(false);
  });

  it('the Android app asks the phone, and shows nothing when the plugin is missing', async () => {
    native = true;
    expect(await soundCaps.detectSoundCaps()).toEqual({ spatial: false, dolby: false });
    expect(caps).not.toHaveBeenCalled();

    soundCaps.resetSoundCapsForTest();
    available = true;
    caps.mockResolvedValue({ spatial: true, spatialAvailable: false, spatialEnabled: true, dolby: true, dolbyApp: false });
    expect(await soundCaps.detectSoundCaps()).toEqual({ spatial: true, dolby: true });
  });

  it('a phone that cannot answer shows neither row', async () => {
    native = true;
    available = true;
    caps.mockRejectedValue(new Error('boom'));
    expect(await soundCaps.detectSoundCaps()).toEqual({ spatial: false, dolby: false });
  });

  it('opens the Dolby settings only in the app', async () => {
    expect(await soundCaps.openDolbySettings()).toBe(false);
    native = true;
    available = true;
    openDolby.mockResolvedValue({ opened: 'dolby' });
    expect(await soundCaps.openDolbySettings()).toBe(true);
    openDolby.mockRejectedValue(new Error('open_failed'));
    expect(await soundCaps.openDolbySettings()).toBe(false);
  });
});
