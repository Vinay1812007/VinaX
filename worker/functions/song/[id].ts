import { renderEntity } from '../_lib/render';

export const onRequestGet = (context: {
  request: Request;
  env: {
    ASSETS: { fetch: (req: Request | string | URL) => Promise<Response> };
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
  };
  params: { id: string };
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> =>
  renderEntity('song', String(context.params.id), context.request, context.env, context.waitUntil);
