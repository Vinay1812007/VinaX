/**
 * GET /api/vinaxcli/meta — what a VinaX CLI client needs to know before it
 * can talk to this Worker.
 *
 * The CLI is a published npm package: whatever it hard-codes is frozen at the
 * version a user installed. So it hard-codes nothing that can drift. The
 * protocol ids it may speak, the engines it may offer, the tools it must
 * implement and the limits it must respect all come from here, live.
 *
 * Nothing secret crosses this boundary: no provider names, no key names, no
 * model pins for the fixed seats. `available` is the same one-bit fact
 * /api/aimodels already publishes — whether an engine can serve a request at
 * all — and it exists so `vinax doctor` can tell a user "that engine is not
 * configured" instead of letting them watch requests fail.
 */
import { methodNotAllowed, rateLimit } from '../../_lib/ratelimit';
import { CLI_TOOLS, LIMITS, SUPPORTED_PROTOCOLS, CLI_PROTOCOL } from '../../_lib/cliprotocol';
import { CLI_ENGINES, engineAvailable } from '../../_lib/cliengines';
import { type AiEnv } from '../../_lib/ai';

type Env = AiEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'vinaxcli-meta', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;

  const body = {
    service: 'VinaX CLI',
    protocol: CLI_PROTOCOL,
    protocols: SUPPORTED_PROTOCOLS,
    engines: CLI_ENGINES.map((e) => ({
      id: e.id,
      label: e.label,
      hint: e.hint,
      acceptsModel: e.acceptsModel,
      ...(e.catalog ? { catalog: e.catalog } : {}),
      available: engineAvailable(env, e),
    })),
    /** Where a model-selectable engine's live menu comes from. */
    catalogEndpoint: '/api/aimodels',
    tools: CLI_TOOLS.map((t) => ({ name: t.name, effect: t.effect })),
    limits: {
      maxSteps: LIMITS.maxSteps,
      maxCallsPerStep: LIMITS.maxCallsPerStep,
      maxMessages: LIMITS.maxMessages,
      maxMessageChars: LIMITS.maxMessageChars,
      maxToolResultChars: LIMITS.maxToolResultChars,
      maxToolResults: LIMITS.maxToolResults,
      maxBodyBytes: LIMITS.maxBodyBytes,
    },
    web: { available: true },
    docs: 'https://www.sirimillavinay.online/VinaXAI/cli/docs',
  };

  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=120, stale-while-revalidate=600',
    },
  });
};

/** GET-only: anything else must 405 rather than fall through to the SPA. */
export const onRequestPost = async (): Promise<Response> => methodNotAllowed('GET, OPTIONS');
