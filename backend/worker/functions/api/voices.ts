/**
 * GET /api/voices — the speech engines the key actually serves, plus their
 * personas, so the listener can choose a voice instead of living with one
 * hard-coded const.
 *
 * The list is discovered the same way the chat menu is (see _lib/catalog.ts):
 * ask the provider what it serves and keep the speech models. If the key is
 * missing or the provider is unreachable, the list comes back EMPTY and the
 * client uses the device's own voice — it never invents a model, because a
 * model that does not exist answers a spoken reply with a 404.
 *
 * No key leaves the Worker: only model ids, labels and persona names.
 *
 * 10.3 — additive `providers`: every FREE speech model on the four keys, per
 * provider, with the voices each one accepts (send them back to POST /api/tts
 * as { provider, model, voice }):
 *   providers: [ { id, label, models: [ { id, name, voices: string[] } ] } ]
 * The older fields (`configured`, `models`, `personas`) are unchanged, so an
 * installed build keeps working.
 */
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';
import { fetchMedia, fetchVoiceCatalog } from '../_lib/catalog';
import { AI_PROVIDERS, PROVIDER_LABEL, providerKey, type AiEnv } from '../_lib/ai';

type Env = AiEnv;

/** Personas the speech models accept, with the gender reading listeners
 *  actually pick by. Probed live on the Orpheus pair; kept in step with the
 *  allow-list in api/tts.ts, which is what enforces it. */
const PERSONAS = [
  { id: 'autumn', label: 'Autumn', tone: 'Warm · conversational' },
  { id: 'diana', label: 'Diana', tone: 'Clear · measured' },
  { id: 'hannah', label: 'Hannah', tone: 'Bright · quick' },
  { id: 'austin', label: 'Austin', tone: 'Warm · low' },
  { id: 'daniel', label: 'Daniel', tone: 'Even · neutral' },
  { id: 'troy', label: 'Troy', tone: 'Deep · steady' },
];

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'voices', { capacity: 12, refillPerMinute: 12 });
  if (limited) return limited;

  const [models, media] = await Promise.all([fetchVoiceCatalog(env, 'groq'), Promise.all(AI_PROVIDERS.map((p) => fetchMedia(env, p)))]);
  return new Response(
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      configured: providerKey(env, 'groq') !== null,
      // Empty means "this key serves no speech model right now" — the client
      // shows the device voice only, and says so.
      models,
      personas: models.length ? PERSONAS : [],
      providers: AI_PROVIDERS.map((id, i) => ({
        id,
        label: PROVIDER_LABEL[id],
        models: media[i].filter((m) => m.kind === 'speech').map((m) => ({ id: m.id, name: m.name, voices: m.voices ?? [] })),
      })),
    }),
    {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=300, stale-while-revalidate=900',
        // 7.2.0 — readable cross-origin (a bundled Android build runs on https://localhost).
        'access-control-allow-origin': '*',
      },
    },
  );
};

/** GET-only: anything else must 405 rather than fall through to the SPA. */
export const onRequestPost = async (): Promise<Response> => methodNotAllowed('GET, OPTIONS');
