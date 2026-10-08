/**
 * 10.3 — GET /api/voices, read shape-tolerantly. The 10.3 server lists every
 * speech model per provider with its voices:
 *
 *   { configured, providers: [{ id, label, models: [{ id, name, voices }] }] }
 *
 * An older server sends `models: [{ id, label }]` and `personas: [{ id }]`
 * from one provider; that reads as that provider's models, each speaking in
 * every persona — so a listener's saved voice still shows as chosen.
 */
import { LEGACY_VOICE_PROVIDER } from '../voicePick';
import { isProviderId, PROVIDER_IDS, PROVIDER_LABEL } from './models';
import type { ProviderId } from './types';

export interface VoiceModel {
  id: string;
  name: string;
  voices: string[];
}
export interface VoiceProvider {
  id: ProviderId;
  label: string;
  models: VoiceModel[];
}
export interface VoiceCatalog {
  configured: boolean;
  providers: VoiceProvider[];
}

export const EMPTY_VOICES: VoiceCatalog = { configured: false, providers: [] };

const SLUG = /^[\w./:@+-]{1,160}$/;
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && SLUG.test(x.trim())).map((x) => x.trim()))].slice(0, 80) : [];
const name = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : fallback);

export function parseVoiceCatalog(body: unknown): VoiceCatalog {
  if (!body || typeof body !== 'object') return EMPTY_VOICES;
  const b = body as Record<string, unknown>;
  const out: VoiceProvider[] = [];
  if (Array.isArray(b.providers)) {
    for (const id of PROVIDER_IDS) {
      const raw = b.providers.find((p): p is Record<string, unknown> => !!p && typeof p === 'object' && (p as { id?: unknown }).id === id);
      if (!raw || !Array.isArray(raw.models)) continue;
      const models: VoiceModel[] = [];
      for (const rm of raw.models) {
        if (!rm || typeof rm !== 'object') continue;
        const m = rm as Record<string, unknown>;
        const mid = typeof m.id === 'string' ? m.id.trim() : '';
        const voices = strs(m.voices);
        if (!SLUG.test(mid) || !voices.length || models.some((x) => x.id === mid)) continue;
        models.push({ id: mid, name: name(m.name, mid), voices });
      }
      if (models.length) out.push({ id, label: PROVIDER_LABEL[id], models });
    }
  } else if (Array.isArray(b.models) && Array.isArray(b.personas)) {
    // An older server: one provider's models × its personas.
    const voices = strs(b.personas.map((p) => (p && typeof p === 'object' ? (p as { id?: unknown }).id : null)));
    const models: VoiceModel[] = [];
    for (const rm of b.models) {
      if (!rm || typeof rm !== 'object') continue;
      const m = rm as Record<string, unknown>;
      const mid = typeof m.id === 'string' ? m.id.trim() : '';
      if (!SLUG.test(mid) || !voices.length) continue;
      models.push({ id: mid, name: name(m.label ?? m.name, mid), voices });
    }
    const legacy = LEGACY_VOICE_PROVIDER;
    if (models.length && isProviderId(legacy)) out.push({ id: legacy, label: PROVIDER_LABEL[legacy], models });
  }
  return { configured: b.configured === true || out.length > 0, providers: out };
}

/** "autumn" → "Autumn" — a voice's name as the picker shows it. */
export const voiceLabel = (v: string): string => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

/** 11.2 — the chosen voice as the voice-chat overlay names it:
 *  "Autumn · Groq", or "Device voice". */
export function voicePickLabel(pick: { provider: string; voice: string } | null): string {
  if (!pick) return 'Device voice';
  const provider = isProviderId(pick.provider) ? PROVIDER_LABEL[pick.provider] : pick.provider;
  return `${voiceLabel(pick.voice)} · ${provider}`;
}
