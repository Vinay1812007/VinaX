/**
 * VinaX AI — who may use Claude (provider `anthropic`). Claude is paid on
 * the owner's Anthropic key, so only these accounts may pick it; everyone
 * else sees the Claude models locked in the picker (GET /api/ai/models,
 * `reason: "locked"`) and the chat refuses them (403 `model_locked`).
 * Auto never uses Claude for anyone: no Claude model is in a ladder.
 *
 * The check is the account row's email, matched exactly (case and spaces
 * aside). That email is only ever written from a Google ID token the Worker
 * verified (api/auth/google.ts), so it is Google's word. The token's
 * `email_verified` claim is not required: the Android app's tokens lack it
 * (1.12), and a gmail.com address is Google's own. Add an email here to
 * share Claude.
 */
import { accountOf } from '../authShared';
import type { DbEnv } from '../db';
import type { ModelSpec, ProviderId } from './types';

export const CLAUDE_EMAILS: ReadonlySet<string> = new Set(['sirimillavinay56@gmail.com']);

/** Providers only the accounts above may use. */
export const LOCKED_PROVIDERS: ReadonlySet<ProviderId> = new Set(['anthropic']);

export const isLockedModel = (spec: Pick<ModelSpec, 'provider'>): boolean => LOCKED_PROVIDERS.has(spec.provider);

export function claudeEmailAllowed(email: unknown): boolean {
  return typeof email === 'string' && CLAUDE_EMAILS.has(email.trim().toLowerCase());
}

/** May this account (a session's `sub`) use Claude? False when signed out or the account cannot be read. */
export async function claudeAllowed(env: DbEnv, accountId: string | null): Promise<boolean> {
  if (!accountId) return false;
  try {
    const r = await accountOf(env, accountId);
    return r.ok && !!r.value && claudeEmailAllowed(r.value.email);
  } catch {
    return false;
  }
}
