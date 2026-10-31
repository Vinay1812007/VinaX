/**
 * VinaX AI — the owner's switches, from the `vinax-ai` setting (written in
 * the console's Settings page):
 *
 *   { enabled: false,             // the kill switch; missing = off
 *     testers: ["<account id>"],  // may use VinaX AI while it is off
 *     search: true,               // web search (phase 3)
 *     models: { "<model id>": { enabled, order } } }
 *
 * Values are sanitised here, so a bad value can never break the chat.
 */
import { setting } from '../settings';
import type { DbEnv } from '../db';
import { applyOverrides, MODELS } from './models';
import type { ModelSpec } from './types';

export interface AiSettings {
  enabled: boolean;
  testers: string[];
  search: boolean;
  models: Record<string, unknown>;
}

export const AI_SETTING_KEY = 'vinax-ai';

export function sanitizeAiSettings(raw: unknown): AiSettings {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const testers = Array.isArray(v.testers) ? v.testers.filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length < 100).slice(0, 50) : [];
  const models = v.models && typeof v.models === 'object' && !Array.isArray(v.models) ? (v.models as Record<string, unknown>) : {};
  return { enabled: v.enabled === true, testers, search: v.search !== false, models };
}

export async function aiSettings(env: DbEnv): Promise<AiSettings> {
  return sanitizeAiSettings(await setting(env, AI_SETTING_KEY));
}

/** May this account use VinaX AI now? */
export const aiOpenFor = (s: AiSettings, accountId: string | null): boolean => s.enabled || (!!accountId && s.testers.includes(accountId));

/** The registry after the owner's model overrides. */
export const registryFor = (s: AiSettings): ModelSpec[] => applyOverrides(MODELS, s.models);
