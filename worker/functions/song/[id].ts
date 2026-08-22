import { renderEntity } from '../_lib/render';

export const onRequestGet = (context: {
  request: Request;
  env: { ASSETS: { fetch: (req: Request | string | URL) => Promise<Response> } };
  params: { id: string };
}): Promise<Response> => renderEntity('song', String(context.params.id), context.request, context.env);
