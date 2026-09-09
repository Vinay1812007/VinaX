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
 */
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';
import { fetchVoiceCatalog } from '../_lib/catalog';
import { type AiEnv } from '../_lib/ai';

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

  const models = await fetchVoiceCatalog(env, 'grq');
  return new Response(
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      configured: Boolean(env.VINAX_GROQ_API_KEY),
      // Empty means "this key serves no speech model right now" — the client
      // shows the device voice only, and says so.
      models,
      personas: models.length ? PERSONAS : [],
    }),
    {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=300, stale-while-revalidate=900',
      },
    },
  );
};

/** GET-only: anything else must 405 rather than fall through to the SPA. */
export const onRequestPost = async (): Promise<Response> => methodNotAllowed('GET, OPTIONS');
