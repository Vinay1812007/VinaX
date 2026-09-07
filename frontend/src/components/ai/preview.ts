import { isNativePlatform } from '@/services/native';

/**
 * v5.11.3 — running assistant-written pages: the sandbox/runtime hop of
 * AI response -> code block UI -> Run -> sandbox/runtime -> output.
 *
 * A srcdoc iframe inherits the app's strict CSP (hashed script-src), which
 * silently blocks every inline script the assistant writes. So the page is
 * POSTed to /api/preview via a plain form targeting the sandboxed iframe, and
 * comes back as a network document with its own permissive policy plus an
 * injected reporter. The same form with a named window is "Open in a new tab".
 *
 * This path is used in dev too: `vite dev` and `vite preview` both proxy /api
 * to the local worker, and the worker lists localhost/127.0.0.1 in
 * frame-ancestors. A DEV-only srcdoc fallback would be an uninstrumented
 * preview that behaves nothing like production — exactly where bugs hide.
 */
export const PREVIEW_ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/preview' : '/api/preview';

export const newToken = (): string => Math.random().toString(36).slice(2, 12);

/** Submit `html` to the preview endpoint, rendering into the window/frame named `target`. */
export function postPreview(html: string, token: string, target: string, title = 'Preview'): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = PREVIEW_ENDPOINT;
  form.target = target;
  form.style.display = 'none';
  form.acceptCharset = 'UTF-8';
  const add = (name: string, value: string) => {
    const el = document.createElement('textarea');
    el.name = name;
    el.value = value;
    form.appendChild(el);
  };
  add('html', html);
  add('token', token);
  add('title', title);
  document.body.appendChild(form);
  try {
    form.submit();
  } finally {
    setTimeout(() => form.remove(), 0);
  }
}

/**
 * "Open in a new tab". Opens the tab FIRST so a blocked popup is detectable —
 * a form with target="_blank" gives no handle back, so a blocked open would
 * otherwise be silent. Returns false when the browser refused.
 */
export function openPreview(html: string, token: string, title = 'Preview'): boolean {
  const name = `vxopen${token}`;
  let win: Window | null;
  try {
    win = window.open('', name);
  } catch {
    return false;
  }
  if (!win) return false;
  postPreview(html, token, name, title);
  try {
    win.focus();
  } catch {
    /* focus is best-effort */
  }
  return true;
}

export interface PreviewEvent {
  kind: 'log' | 'error' | 'ready';
  text: string;
}

/**
 * Listen for the injected reporter's messages for one token.
 *
 * `frameRef` is dereferenced INSIDE the handler, never captured: the preview
 * iframe carries key={runKey}, so every Run mounts a new DOM node while this
 * listener stays registered.
 */
export function onPreviewMessage(
  token: string,
  cb: (e: PreviewEvent) => void,
  frameRef?: { current: HTMLIFrameElement | null },
): () => void {
  const handler = (e: MessageEvent): void => {
    const el = frameRef?.current;
    // e.origin is the string "null" for an opaque-origin frame, so identity of
    // the sending window is the only check available.
    if (el && e.source !== el.contentWindow) return;
    const d = e.data as { vxPreview?: string; kind?: string; text?: string } | null;
    if (!d || d.vxPreview !== token || !d.kind) return;
    if (d.kind === 'log' || d.kind === 'error' || d.kind === 'ready') cb({ kind: d.kind, text: String(d.text ?? '') });
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/** Wrap a JS snippet as a page whose console reaches the chat. */
export function scriptPage(code: string, token: string): string {
  const t = token.replace(/[^\w-]/g, '');
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>Run</title></head><body><script>' +
    code.replace(/<\/script/gi, '<\\/script') +
    // Runs after the snippet: proves the script parsed and finished, so the UI
    // can say "finished, no output" instead of hanging on "Running…".
    `\n;try{parent.postMessage({vxPreview:'${t}',kind:'log',text:'✓ finished'},'*')}catch(e){}` +
    '</script></body></html>'
  );
}
