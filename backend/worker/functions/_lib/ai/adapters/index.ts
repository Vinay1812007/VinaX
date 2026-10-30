/** VinaX AI — the adapter for each provider, and whether its key is set. */
import { gemini } from './gemini';
import { groq, nvidia, openrouter } from './openaiCompat';
import { workersAi } from './workersAi';
import type { Adapter, AiEnv, ProviderId } from '../types';

export const ADAPTERS: Readonly<Record<ProviderId, Adapter>> = { groq, gemini, openrouter, nvidia, cloudflare: workersAi };

export const PROVIDER_NAMES: Readonly<Record<ProviderId, string>> = {
  groq: 'Groq',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA',
  cloudflare: 'Cloudflare',
};

export const PROVIDERS: readonly ProviderId[] = ['groq', 'gemini', 'openrouter', 'nvidia', 'cloudflare'];

const set = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

export function providerConfigured(env: AiEnv, provider: ProviderId): boolean {
  switch (provider) {
    case 'groq': return set(env.GROQ_API_KEY);
    case 'gemini': return set(env.GEMINI_API_KEY);
    case 'openrouter': return set(env.OPENROUTER_API_KEY);
    case 'nvidia': return set(env.NVIDIA_API_KEY);
    case 'cloudflare': return !!env.AI && typeof env.AI.run === 'function';
  }
}

export const anyProviderConfigured = (env: AiEnv): boolean => PROVIDERS.some((p) => providerConfigured(env, p));
