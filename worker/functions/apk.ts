/** Same-origin shortcut: /apk -> the streamed latest APK (works on any domain). */
export const onRequestGet = async (context: { request: Request }): Promise<Response> => {
  const origin = new URL(context.request.url).origin;
  return Response.redirect(`${origin}/api/apk`, 302);
};
