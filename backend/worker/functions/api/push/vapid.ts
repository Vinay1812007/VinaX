/** Public VAPID key so browsers can subscribe to push. */
import type { VapidEnv } from '../../_lib/webpush';

export const onRequestGet = async (context: { env: VapidEnv }): Promise<Response> => {
  return new Response(JSON.stringify({ key: context.env.VAPID_PUBLIC_KEY ?? null }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
  });
};
