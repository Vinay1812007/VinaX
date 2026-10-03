// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./browserSignals', () => ({ readBrowserSignals: () => ({ country: 'GB', languages: [], timezone: 'Europe/London' }) }));

import { assistantPlace } from './assistantPlace';
import { useSettingsStore } from '@/store/settingsStore';

const EDGE = { country: 'IN', regionLabel: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata', source: 'edge' as const };

beforeEach(() => {
  useSettingsStore.setState({ allowRegionInference: true, manualCountry: null, manualRegionLabel: null, inferredRegion: null });
});

describe('assistantPlace — nothing leaves the device unless the listener allowed it', () => {
  it('sends NOTHING when inference is off and no override is set', () => {
    useSettingsStore.setState({ allowRegionInference: false, inferredRegion: EDGE });
    expect(assistantPlace()).toBeUndefined();
  });

  it('sends a manual override even when inference is off — the listener typed it', () => {
    useSettingsStore.setState({ allowRegionInference: false, manualCountry: 'LK', manualRegionLabel: 'Western' });
    expect(assistantPlace()).toEqual({ country: 'LK', region: 'Western', city: null, timezone: 'Europe/London', source: 'manual' });
  });

  it('never attaches a city to a manual override (they chose a country, not a city)', () => {
    useSettingsStore.setState({ manualCountry: 'IN', inferredRegion: EDGE });
    expect(assistantPlace()!.city).toBeNull();
  });

  it('sends the inferred place when inference is allowed', () => {
    useSettingsStore.setState({ inferredRegion: EDGE });
    expect(assistantPlace()).toEqual({ country: 'IN', region: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata', source: 'edge' });
  });

  it('sends the time zone alone when inference is allowed but nothing resolved', () => {
    useSettingsStore.setState({ inferredRegion: null });
    expect(assistantPlace()).toEqual({ country: null, region: null, city: null, timezone: 'Europe/London', source: 'browser' });
  });

  it('marks a browser-derived place as such, so the prompt can say how coarse it is', () => {
    useSettingsStore.setState({ inferredRegion: { country: 'GB', regionLabel: null, city: null, timezone: 'Europe/London', source: 'browser' } });
    expect(assistantPlace()!.source).toBe('browser');
  });

  it('carries only the four coarse fields — never anything finer', () => {
    useSettingsStore.setState({ inferredRegion: EDGE });
    expect(Object.keys(assistantPlace()!).sort()).toEqual(['city', 'country', 'region', 'source', 'timezone']);
  });
});
