/**
 * VinaX AI Live voice — showing Gemini things: the camera, the screen (where
 * the browser can share it) or a photo. Gemini Live takes pictures as video
 * frames (liveProtocol.ts videoMessage); about one a second is what Google's
 * Live guide suggests, each at most 768 px on its longer side as a JPEG.
 * Nothing is stored: frames go straight to Gemini while sharing is on, and
 * stop the moment it is switched off or the call ends.
 */
import { isNativePlatform } from '@/services/native';

export type ShareKind = 'camera' | 'screen';
export const FRAME_EVERY_MS = 1_000;
export const FRAME_MAX_SIDE = 768;
const JPEG_QUALITY = 0.7;

/** The browser can share a screen (desktop browsers; not phones or the Android app). */
export function screenShareSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function' && !isNativePlatform() && !/Android|iPhone|iPad/i.test(navigator.userAgent);
}

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/** A picture as base64 JPEG (no data: prefix), scaled to FRAME_MAX_SIDE; null when it has no size yet. */
export function jpegOf(source: CanvasImageSource, width: number, height: number, canvas: HTMLCanvasElement = document.createElement('canvas')): string | null {
  if (!width || !height) return null;
  const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const comma = url.indexOf(',');
  return comma > 0 && url.startsWith('data:image/jpeg') ? url.slice(comma + 1) : null;
}

/** A photo the listener picked, as one frame. */
export async function photoFrame(file: Blob): Promise<string | null> {
  if (!/^image\//.test(file.type) || file.size > 25 * 1024 * 1024) return null;
  try {
    const bmp = await createImageBitmap(file);
    try { return jpegOf(bmp, bmp.width, bmp.height); } finally { bmp.close?.(); }
  } catch {
    return null;
  }
}

/** The camera or the screen, sending a frame every second until stopped. */
export class FrameShare {
  stream: MediaStream | null = null;
  kind: ShareKind | null = null;
  facing: 'user' | 'environment' = 'environment';
  private video: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

  constructor(private readonly onFrame: (jpeg: string) => void, private readonly onEnded: () => void) {}

  async start(kind: ShareKind): Promise<void> {
    this.stop();
    const md = navigator.mediaDevices;
    const stream = kind === 'screen'
      ? await md.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
      : await md.getUserMedia({ video: { facingMode: this.facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    this.stream = stream;
    this.kind = kind;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    this.video = v;
    void v.play().catch(() => undefined);
    // The browser's own "Stop sharing" button ends the track.
    for (const t of stream.getVideoTracks()) t.addEventListener('ended', () => { if (this.stream === stream) { this.stop(); this.onEnded(); } });
    this.timer = setInterval(() => this.grab(), FRAME_EVERY_MS);
  }

  /** The other camera (front / back). */
  async flip(): Promise<void> {
    if (this.kind !== 'camera') return;
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    await this.start('camera');
  }

  private grab(): void {
    const v = this.video;
    if (!v || !this.canvas || v.readyState < 2) return;
    const jpeg = jpegOf(v, v.videoWidth, v.videoHeight, this.canvas);
    if (jpeg) this.onFrame(jpeg);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const t of this.stream?.getTracks() ?? []) { try { t.stop(); } catch { /* stopped */ } }
    if (this.video) this.video.srcObject = null;
    this.stream = null;
    this.video = null;
    this.kind = null;
  }
}
