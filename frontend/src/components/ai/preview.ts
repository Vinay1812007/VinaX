import { isNativePlatform } from '@/services/native';

/**
 * v5.11.2 — running assistant-written pages. A srcdoc iframe inherits the
 * app's strict CSP (hashed script-src), which silently blocks every inline
 * script the assistant writes; so the page is POSTed to /api/preview via a
 * plain form targeting the sandboxed iframe, and comes back as a network
 * document with its own permissive policy. The same form with target=_blank
 * is "Open in a new tab".
 */
export const PREVIEW_ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/preview' : '/api/preview';

/** Dev server has no Functions — fall back to srcdoc (no CSP there either). */
export const PREVIEW_VIA_SERVER = !import.meta.env.DEV;

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

export interface PreviewEvent {
  kind: 'log' | 'error' | 'ready';
  text: string;
}

/** Listen for the injected reporter's messages for one token. */
export function onPreviewMessage(token: string, cb: (e: PreviewEvent) => void): () => void {
  const handler = (e: MessageEvent): void => {
    const d = e.data as { vxPreview?: string; kind?: string; text?: string } | null;
    if (!d || d.vxPreview !== token || !d.kind) return;
    if (d.kind === 'log' || d.kind === 'error' || d.kind === 'ready') cb({ kind: d.kind, text: String(d.text ?? '') });
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/** Wrap a JS/TS snippet as a page whose console reaches the chat. */
export function scriptPage(code: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Run</title></head><body><script>${code.replace(/<\/script/gi, '<\\/script')}\n;(function(){try{parent.postMessage({vxPreview:(document.currentScript&&document.currentScript.getAttribute('data-token'))||'',kind:'log',text:'\\u2713 finished'},'*')}catch(e){}})();</script></body></html>`;
}
