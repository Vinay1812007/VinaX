/**
 * Cloudflare Pages Function: privacy-safe coarse geo hint.
 *
 * Returns ONLY the two-letter country code (CF-IPCountry header) and, when
 * Cloudflare provides it, a human-readable region name from request.cf.
 * The visitor's IP address is read by Cloudflare's edge as part of normal
 * request handling but is NEVER returned to the client, NEVER logged by this
 * function, and NEVER stored anywhere by VinaX.
 *
 * Local dev / non-Cloudflare hosting: this route simply 404s and the client
 * falls back to browser locale/timezone signals (see
 * src/services/location/browserSignals.ts).
 */
interface CfRequestExtras {
  cf?: { country?: string; region?: string };
}

export const onRequestGet = async (context: { request: Request }): Promise<Response> => {
  const { request } = context;
  const cf = (request as Request & CfRequestExtras).cf ?? {};
  const country = request.headers.get('CF-IPCountry') ?? cf.country ?? null;
  const region = cf.region ?? null;

  return new Response(
    JSON.stringify({
      country: country && country !== 'XX' && country !== 'T1' ? country : null,
      region,
      source: 'edge',
    }),
    {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    },
  );
};
