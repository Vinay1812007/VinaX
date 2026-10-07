import { useSettingsStore } from '@/store/settingsStore';
import { readBrowserSignals } from './browserSignals';

/**
 * 9.1.0 — the ONLY coarse place VinaX ever sends to the server for an AI reply.
 *
 * The rule this function exists to enforce, in one place rather than at every
 * call site: **nothing leaves the device unless the listener allowed it.**
 *
 *   manual override set      → send it (they typed it themselves), plus the
 *                              device's time zone.
 *   inference allowed        → send the inferred country / region / approximate
 *                              city and the zone.
 *   inference off, no manual → send NOTHING (undefined). The server then opens
 *                              its prompt with the IST clock, exactly as every
 *                              build before 9.1 did for everyone.
 *
 * What is never sent, at any setting: an IP address (the app never sees one —
 * /api/geo returns coarse fields only), coordinates, an address, or anything
 * finer than the edge's approximate city.
 *
 * The listener's LANGUAGES are deliberately not part of this. They travel in the
 * taste snapshot and are an explicit preference; place must never be used to
 * guess them, and the server prompt says so.
 */
export interface AssistantPlace {
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  source: 'manual' | 'edge' | 'browser';
}

/** 11.0 — what a chat request carries in `place`, now that the chat has no
 *  Place switch of its own:
 *    a place            — the listener allows one (manual, or inference on);
 *    `{ off: true }`    — region inference is OFF and no override is set: the
 *                         server then uses no place at all (not even the
 *                         edge's) and opens with the IST clock;
 *    undefined          — inference is on but nothing was resolved: the server
 *                         may use the edge's coarse place for local time. */
export function assistantPlaceRequest(): AssistantPlace | { off: true } | undefined {
  const p = assistantPlace();
  if (p) return p;
  try {
    return useSettingsStore.getState().allowRegionInference ? undefined : { off: true };
  } catch {
    return undefined;
  }
}

export function assistantPlace(): AssistantPlace | undefined {
  let settings: ReturnType<typeof useSettingsStore.getState>;
  try {
    settings = useSettingsStore.getState();
  } catch {
    return undefined; // no store (tests, a very early call): send nothing
  }
  const timezone = readBrowserSignals().timezone;

  if (settings.manualCountry) {
    return {
      country: settings.manualCountry,
      region: settings.manualRegionLabel ?? null,
      city: null,
      timezone,
      source: 'manual',
    };
  }
  if (!settings.allowRegionInference) return undefined;
  const inferred = settings.inferredRegion;
  if (!inferred?.country) {
    // Inference is allowed but nothing was resolved. The time zone alone is a
    // device setting rather than an inference about the network, and it is what
    // makes "what time is it" answerable, so it may still go.
    return timezone ? { country: null, region: null, city: null, timezone, source: 'browser' } : undefined;
  }
  return {
    country: inferred.country,
    region: inferred.regionLabel ?? null,
    city: inferred.city ?? null,
    timezone: inferred.timezone ?? timezone,
    source: inferred.source === 'browser' ? 'browser' : 'edge',
  };
}
