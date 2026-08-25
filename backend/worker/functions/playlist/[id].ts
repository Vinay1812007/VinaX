import { renderEntity } from '../_lib/render';

export const onRequestGet = (context: {
  request: Request;
  env: {
    ASSETS: { fetch: (req: Request | string | URL) => Promise<Response> };
  };
  params: { id: string };
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> =>
  renderEntity('playlist', String(context.params.id), context.request, context.env, context.waitUntil);
