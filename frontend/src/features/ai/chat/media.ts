/**
 * 10.3 — the non-chat models in the chat: Create image, Create music clip and
 * server dictation. Request bodies, response reading, failure lines and the
 * stored model picks, with no React in them so each is unit-tested.
 *
 * Nothing is invented: a picker lists only what GET /api/aimodels returned,
 * a pick the server no longer lists falls back to the first one it does, and
 * a failure says what happened in one plain line.
 */
import { IMAGE_ENDPOINT, MUSIC_ENDPOINT, TRANSCRIBE_ENDPOINT, clientHeaders } from './endpoints';
import { isProviderId, mediaGroups, PROVIDER_LABEL } from './models';
import type { MediaKind, MediaPick, MsgMedia, Provider } from './types';

/** What the composer can create. */
export type CreateKind = 'image' | 'music';

/* ---------- stored picks ---------- */

/** The last model used for each kind, as `{ provider, model, name }` JSON. */
export const MEDIA_PICK_KEY: Record<CreateKind | 'transcription', string> = {
  image: 'vinax.aiImageModel',
  music: 'vinax.aiMusicModel',
  transcription: 'vinax.aiDictation',
};
/** The dictation setting's "this device" value (also what an unset key means). */
export const DEVICE_DICTATION = 'device';

const SLUG_RE = /^[\w./:@+-]{1,160}$/;

/** A stored pick → a valid one, or null. */
export function revivePick(raw: unknown): MediaPick | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { provider?: unknown; model?: unknown; name?: unknown };
  if (!isProviderId(r.provider) || typeof r.model !== 'string' || !SLUG_RE.test(r.model)) return null;
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 120) : undefined;
  return name ? { provider: r.provider, model: r.model, name } : { provider: r.provider, model: r.model };
}

export function loadMediaPick(kind: CreateKind | 'transcription'): MediaPick | null {
  try {
    const raw = localStorage.getItem(MEDIA_PICK_KEY[kind]);
    if (!raw || raw === DEVICE_DICTATION) return null;
    return revivePick(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** null clears it (for dictation: back to this device). */
export function saveMediaPick(kind: CreateKind | 'transcription', pick: MediaPick | null): void {
  try {
    if (pick) localStorage.setItem(MEDIA_PICK_KEY[kind], JSON.stringify(pick));
    else localStorage.removeItem(MEDIA_PICK_KEY[kind]);
  } catch {
    /* private mode: the pick simply does not persist */
  }
}

/** The model a create flow starts on: the saved one while the server still
 *  lists it, else the first one available (provider order, then list order).
 *  Null when nothing of that kind is served. */
export function resolveMediaPick(providers: readonly Provider[], kind: MediaKind, saved: MediaPick | null): MediaPick | null {
  const groups = mediaGroups(providers, kind);
  if (saved) {
    const live = groups.find((g) => g.provider === saved.provider)?.models.find((m) => m.id === saved.model);
    if (live) return { provider: saved.provider, model: live.id, name: live.name };
  }
  const first = groups[0];
  return first ? { provider: first.provider, model: first.models[0].id, name: first.models[0].name } : null;
}

/* ---------- create image / music ---------- */

/** POST /api/image and POST /api/music take the same body. */
export function createRequestBody(prompt: string, pick: MediaPick | null): { prompt: string; provider?: string; model?: string } {
  const p = prompt.trim().slice(0, 2000);
  return pick ? { prompt: p, provider: pick.provider, model: pick.model } : { prompt: p };
}

const str = (v: unknown, max = 160): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** A successful answer → the message's media, or null when it holds nothing
 *  playable or viewable (a data URL of the right kind). */
export function readCreateResponse(kind: CreateKind, body: unknown, prompt: string, pick: MediaPick | null): MsgMedia | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const src = kind === 'image' ? b.image : b.audio;
  if (typeof src !== 'string' || !src.startsWith(kind === 'image' ? 'data:image/' : 'data:audio/')) return null;
  const provider = isProviderId(b.provider) ? b.provider : pick?.provider;
  const mime = str(b.mime, 60) || src.slice(5, src.indexOf(';') > 0 ? src.indexOf(';') : undefined);
  return {
    kind,
    src,
    ...(kind === 'music' && mime ? { mime } : {}),
    model: str(b.model, 120) || pick?.name || str(b.modelId) || (kind === 'image' ? 'Image model' : 'Music model'),
    ...(provider ? { provider } : {}),
    prompt: prompt.trim().slice(0, 2000),
  };
}

/** One plain line for a create that did not work. */
export function createFailureLine(kind: CreateKind, status: number, error: string | null): string {
  if (error === 'ai_disabled') return 'VinaX AI is switched off right now — try again later.';
  if (error === 'ai_over_budget') return 'VinaX AI has reached today’s limit — try again tomorrow.';
  if (error === 'unknown_model') return 'That model isn’t available any more — pick another one and try again.';
  if (status === 429 || error === 'rate_limited') return 'Too many requests just now — wait a moment and try again.';
  if (status === 404 || status === 405) return kind === 'image' ? 'Creating images isn’t available right now.' : 'Creating music isn’t available right now.';
  return kind === 'image'
    ? 'The image model didn’t answer — try once more in a moment.'
    : 'The music model didn’t answer — try once more in a moment.';
}

export type CreateResult = { ok: true; media: MsgMedia } | { ok: false; line: string; aborted?: boolean };

/** Ask for one picture or one clip. Never throws. */
export async function createMedia(kind: CreateKind, prompt: string, pick: MediaPick | null, signal?: AbortSignal): Promise<CreateResult> {
  try {
    const r = await fetch(kind === 'image' ? IMAGE_ENDPOINT : MUSIC_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...clientHeaders() },
      body: JSON.stringify(createRequestBody(prompt, pick)),
      signal,
    });
    const j = (await r.json().catch(() => null)) as unknown;
    const media = r.ok ? readCreateResponse(kind, j, prompt, pick) : null;
    if (media) return { ok: true, media };
    const error = j && typeof j === 'object' ? str((j as { error?: unknown }).error, 60) || null : null;
    return { ok: false, line: createFailureLine(kind, r.ok ? 503 : r.status, error) };
  } catch {
    if (signal?.aborted) return { ok: false, line: 'Stopped before it was made.', aborted: true };
    return { ok: false, line: createFailureLine(kind, 0, null) };
  }
}

/** "Made with Model · Provider" — the attribution under a picture or clip. */
export function mediaAttribution(m: Pick<MsgMedia, 'model' | 'provider'>): string {
  return m.provider ? `${m.model} · ${PROVIDER_LABEL[m.provider]}` : m.model;
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
};

/** The file name a Download link offers. */
export function mediaFileName(m: Pick<MsgMedia, 'kind' | 'src' | 'mime' | 'prompt'>): string {
  const mime = (m.mime || m.src.slice(5, Math.max(5, m.src.indexOf(';')))).split(';')[0].toLowerCase();
  const ext = EXT[mime] ?? (m.kind === 'image' ? 'png' : 'wav');
  const slug =
    m.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || (m.kind === 'image' ? 'image' : 'clip');
  return `vinax-${slug}.${ext}`;
}

/* ---------- server dictation ---------- */

/** The route's cap on one recording (≈8 MB once encoded). */
export const TRANSCRIBE_MAX_BYTES = 8_000_000;

export function transcribeRequestBody(
  audio: string,
  mime: string,
  pick: MediaPick,
  language?: string,
): { audio: string; mime: string; provider: string; model: string; language?: string } {
  return { audio, mime, provider: pick.provider, model: pick.model, ...(language ? { language } : {}) };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => (typeof fr.result === 'string' ? resolve(fr.result) : reject(new Error('unreadable')));
    fr.onerror = () => reject(fr.error ?? new Error('unreadable'));
    fr.readAsDataURL(blob);
  });
}

/** Send one recording to the chosen model. The text, or null on ANY failure
 *  (too large, offline, an error, an empty answer) — never throws. */
export async function transcribe(blob: Blob, pick: MediaPick, opts: { signal?: AbortSignal; language?: string } = {}): Promise<string | null> {
  if (!blob.size || blob.size > TRANSCRIBE_MAX_BYTES) return null;
  try {
    const mime = (blob.type || 'audio/webm').split(';')[0];
    const audio = await blobToDataUrl(blob);
    const r = await fetch(TRANSCRIBE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...clientHeaders() },
      body: JSON.stringify(transcribeRequestBody(audio, mime, pick, opts.language)),
      signal: opts.signal,
    });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof j?.text === 'string' ? j.text.trim() : '';
    return text || null;
  } catch {
    return null;
  }
}

/** A base64 data URL → a Blob, or null when it is not one. The site's
 *  content policy plays audio from `blob:` URLs only, never `data:`. */
export function dataUrlToBlob(src: string): Blob | null {
  const m = /^data:([^;,]+)(;[^,]*)?,(.*)$/s.exec(src);
  if (!m) return null;
  try {
    const isB64 = (m[2] ?? '').includes(';base64');
    const raw = isB64 ? atob(m[3]) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  } catch {
    return null;
  }
}
