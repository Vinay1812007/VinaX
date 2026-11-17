/**
 * Retired: "Move to a new device" (the encrypted QR handoff relay) is gone.
 * Signing in with the same account brings a library across, and the backup
 * file is the offline fallback. Installed apps from before the removal still
 * call this route, so it answers a clear 410 { error: 'gone' } (with CORS, so
 * the Android app can read it) and their page lands on its error line instead
 * of hanging. Nothing is stored or read. Delete this file and its EXACT entry
 * in worker/index.ts once those builds have aged out.
 */

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' };

const gone = async (): Promise<Response> => new Response(JSON.stringify({ error: 'gone' }), { status: 410, headers: HEADERS });

export const onRequestGet = gone;
export const onRequestPost = gone;

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  });
