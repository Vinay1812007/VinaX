/**
 * VinaX AI — making a picture from a prompt (POST /api/ai/images), with
 * Workers AI's FLUX.1 schnell on the `AI` binding. Only VinaX AI makes
 * pictures: nothing on the music side calls this.
 *
 * The model answers `{ image: "<base64>" }` (a JPEG today; PNG and WebP are
 * recognised too, by their first bytes). It runs on the same free pool of
 * about 10,000 neurons a day as the hand-picked Workers AI chat models, so
 * it is off until the owner switches it on (`vinax-ai.images`), each person
 * has a daily cap, and everyone together has a fixed one.
 *
 * Neurons, counted high on purpose: FLUX.1 schnell costs 4.8 neurons per
 * 512×512 tile and 9.6 per step; a 1024×1024 picture at 4 steps is 4 tiles
 * and 4 steps = 57.6, so each picture is counted as 60.
 */
import { workersAiError } from './adapters/workersAi';
import type { ProviderError } from './errors';
import type { AiEnv } from './types';

export const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
/** The registry-style id saved on the reply (`model_id`). */
export const IMAGE_MODEL_ID = `cloudflare:${IMAGE_MODEL}`;
export const IMAGE_MODEL_LABEL = Object.freeze({ name: 'FLUX.1 schnell', provider: 'Cloudflare' });
/** FLUX.1 schnell's default; more steps cost more neurons for little gain. */
export const IMAGE_STEPS = 4;
/** The model takes up to 2,048 characters; a shorter prompt is plenty for a picture. */
export const MAX_PROMPT_CHARS = 1_000;
/** Neurons one picture is counted as (57.6 rounded up; see above). */
export const NEURONS_PER_IMAGE = 60;
/** Workers AI's free pool for the whole account, shared with the Workers AI chat models. */
export const NEURON_POOL = 10_000;
/** Pictures a day for everyone together: 50 × 60 = 3,000 neurons, under a third of the pool. */
export const IMAGES_PER_DAY_TOTAL = 50;
/** The owner's per-person cap: [min, max, default]. */
export const IMAGES_PER_DAY_RANGE = Object.freeze([1, 50, 10] as const);
/** A picture larger than this is refused (FLUX's 1024 px JPEGs are well under 1 MB). */
export const MAX_IMAGE_OUT_BYTES = 5 * 1024 * 1024;

export interface ImageSettings {
  /** Off unless the owner switches it on. */
  enabled: boolean;
  /** Pictures one person may make a day (UTC). */
  perDay: number;
}

/**
 * `vinax-ai.images`: `{ enabled, perDay }`, or `true` (on, the default cap).
 * Missing or anything else = off; a bad cap is the default, a cap out of
 * range is clamped.
 */
export function sanitizeImages(raw: unknown): ImageSettings {
  const [min, max, def] = IMAGES_PER_DAY_RANGE;
  if (raw === true) return { enabled: true, perDay: def };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { enabled: false, perDay: def };
  const v = raw as Record<string, unknown>;
  const n = Number(v.perDay);
  const perDay = v.perDay != null && v.perDay !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
  return { enabled: v.enabled === true, perDay };
}

/**
 * Words a picture prompt may not use: sexual content, and children in any
 * prompt that also reads as sexual or violent. A small, plain list on top of
 * the model's own filter; it errs on the side of refusing.
 */
const SEXUAL = /\b(nude|nudes|nudity|naked|topless|nsfw|porn\w*|sex|sexy|sexual\w*|erotic\w*|hentai|fetish\w*|lingerie|genital\w*|nipples?|undress\w*|xxx)\b/i;
const MINOR = /\b(child|children|kid|kids|minor|minors|underage|teen|teens|teenage\w*|boy|girl|loli\w*|shota|toddler|baby|infant|schoolgirl|schoolboy)\b/i;
const VIOLENT = /\b(gore|gory|behead\w*|dismember\w*|mutilat\w*|torture\w*|bloody corpse)\b/i;

export function promptRefused(prompt: string): boolean {
  if (SEXUAL.test(prompt)) return true;
  return MINOR.test(prompt) && VIOLENT.test(prompt);
}

export type PromptCheck = { ok: true; prompt: string } | { ok: false; error: 'empty_prompt' | 'prompt_too_long' | 'prompt_refused' | 'bad_request' };

/** The prompt as plain text (control characters out, spaces folded), or why it is refused. */
export function checkPrompt(raw: unknown): PromptCheck {
  if (raw != null && typeof raw !== 'string') return { ok: false, error: 'bad_request' };
  // eslint-disable-next-line no-control-regex
  const prompt = (raw ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!prompt) return { ok: false, error: 'empty_prompt' };
  if (prompt.length > MAX_PROMPT_CHARS) return { ok: false, error: 'prompt_too_long' };
  if (promptRefused(prompt)) return { ok: false, error: 'prompt_refused' };
  return { ok: true, prompt };
}

/** The picture's type from its first bytes, or null when it is not a picture. */
export function imageMime(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, j) => b[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

/** Bytes from base64 (the model's `image`); null when it is not base64. */
export function fromBase64(s: string): Uint8Array | null {
  const clean = s.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  try {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** A file name from the prompt's first words: "a-red-fox-in-snow.jpg". */
export function imageFileName(prompt: string, mime: string): string {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const words = prompt.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join('-').slice(0, 60).replace(/-+$/, '');
  return `${words || 'vinax-image'}.${ext}`;
}

async function bytesOf(out: unknown): Promise<Uint8Array | null> {
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (out instanceof ReadableStream) {
    const buf = new Uint8Array(await new Response(out).arrayBuffer());
    return buf;
  }
  const image = out && typeof out === 'object' ? (out as { image?: unknown }).image : undefined;
  return typeof image === 'string' ? fromBase64(image) : null;
}

export type ImageResult =
  | { ok: true; bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' | 'image/webp'; ms: number }
  | { ok: false; error: 'not_configured' | 'images_busy' | 'image_refused' | 'image_failed'; cause?: ProviderError };

/** Ask FLUX.1 schnell for one picture. */
export async function generateImage(env: AiEnv, prompt: string): Promise<ImageResult> {
  if (!env.AI || typeof env.AI.run !== 'function') return { ok: false, error: 'not_configured' };
  const started = Date.now();
  let out: unknown;
  try {
    out = await env.AI.run(IMAGE_MODEL, { prompt, steps: IMAGE_STEPS });
  } catch (e) {
    const err = workersAiError(e);
    // The day's neurons are spent, or the binding is rate limited: try later (tomorrow, for the pool).
    if (err.kind === 'quota' || err.kind === 'rate') return { ok: false, error: 'images_busy', cause: err };
    // The model's own filter, or a prompt it cannot take.
    if (err.kind === 'bad_request') return { ok: false, error: 'image_refused', cause: err };
    return { ok: false, error: 'image_failed', cause: err };
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await bytesOf(out);
  } catch {
    bytes = null;
  }
  if (!bytes || !bytes.length || bytes.length > MAX_IMAGE_OUT_BYTES) return { ok: false, error: 'image_failed' };
  const mime = imageMime(bytes);
  if (!mime) return { ok: false, error: 'image_failed' };
  return { ok: true, bytes, mime, ms: Date.now() - started };
}
