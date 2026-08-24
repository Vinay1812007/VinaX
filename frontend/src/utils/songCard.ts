import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';
import { bestImage } from '@/utils/images';
import { shareOrSaveImage } from '@/utils/shareImage';

const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Same-origin CORS image proxy so the cover can be drawn on a canvas. */
function proxied(url: string): string {
  const base = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';
  return `${base}/img?url=${encodeURIComponent(url)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

function roundRect(x: CanvasRenderingContext2D, rx: number, ry: number, w: number, h: number, r: number): void {
  x.beginPath();
  x.moveTo(rx + r, ry);
  x.arcTo(rx + w, ry, rx + w, ry + h, r);
  x.arcTo(rx + w, ry + h, rx, ry + h, r);
  x.arcTo(rx, ry + h, rx, ry, r);
  x.arcTo(rx, ry, rx + w, ry, r);
  x.closePath();
}

/** Render + share a square "now playing" card with the cover art. */
export async function shareSongCard(song: Song): Promise<boolean> {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1080;
  const x = c.getContext('2d');
  if (!x) return false;

  const grad = x.createLinearGradient(0, 0, 0, 1080);
  grad.addColorStop(0, '#15101c');
  grad.addColorStop(1, '#08080c');
  x.fillStyle = grad;
  x.fillRect(0, 0, 1080, 1080);

  let art: HTMLImageElement | null;
  try {
    art = await loadImage(proxied(bestImage(song.images, 500)));
  } catch {
    art = null;
  }

  if (art) {
    // Blurred, dimmed backdrop from the artwork (degrades gracefully if the
    // browser ignores ctx.filter).
    x.save();
    try {
      x.filter = 'blur(48px)';
    } catch {
      /* filter unsupported */
    }
    x.globalAlpha = 0.55;
    x.drawImage(art, -120, -120, 1320, 1320);
    x.restore();
    x.fillStyle = 'rgba(8,8,12,0.55)';
    x.fillRect(0, 0, 1080, 1080);

    // Sharp rounded cover.
    const size = 620;
    const ax = (1080 - size) / 2;
    const ay = 150;
    x.save();
    roundRect(x, ax, ay, size, size, 40);
    x.clip();
    x.drawImage(art, ax, ay, size, size);
    x.restore();
    x.save();
    roundRect(x, ax, ay, size, size, 40);
    x.lineWidth = 2;
    x.strokeStyle = 'rgba(255,255,255,0.12)';
    x.stroke();
    x.restore();
  }

  x.textAlign = 'center';
  x.fillStyle = '#ffffff';
  x.font = '800 60px -apple-system, BlinkMacSystemFont, sans-serif';
  x.fillText(trunc(song.title, 22), 540, 900);
  x.fillStyle = '#cfcfda';
  x.font = '500 38px -apple-system, BlinkMacSystemFont, sans-serif';
  x.fillText(trunc(song.subtitle, 32), 540, 956);
  x.fillStyle = '#818cf8';
  x.font = '700 30px -apple-system, BlinkMacSystemFont, sans-serif';
  x.fillText('♫  Playing on VinaX', 540, 1024);

  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) return false;
  await shareOrSaveImage(blob, 'vinax-song.png', `${song.title} — VinaX`);
  return true;
}

/** Package D15 — 9:16 story-sized card (1080×1920) for Instagram/WhatsApp
 *  status. Same visual language as the square card, laid out tall. */
export async function shareSongStoryCard(song: Song): Promise<boolean> {
  const W = 1080;
  const H = 1920;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  if (!x) return false;

  const grad = x.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#15101c');
  grad.addColorStop(1, '#08080c');
  x.fillStyle = grad;
  x.fillRect(0, 0, W, H);

  let art: HTMLImageElement | null;
  try {
    art = await loadImage(proxied(bestImage(song.images, 500)));
  } catch {
    art = null;
  }

  if (art) {
    x.save();
    try {
      x.filter = 'blur(64px)';
    } catch {
      /* filter unsupported */
    }
    x.globalAlpha = 0.5;
    // Cover-fit the square art over the tall frame for the backdrop.
    x.drawImage(art, -480, -60, 2040, 2040);
    x.restore();
    x.fillStyle = 'rgba(8,8,12,0.6)';
    x.fillRect(0, 0, W, H);

    const size = 780;
    const ax = (W - size) / 2;
    const ay = 420;
    x.save();
    roundRect(x, ax, ay, size, size, 48);
    x.clip();
    x.drawImage(art, ax, ay, size, size);
    x.restore();
    x.save();
    roundRect(x, ax, ay, size, size, 48);
    x.lineWidth = 2;
    x.strokeStyle = 'rgba(255,255,255,0.12)';
    x.stroke();
    x.restore();
  }

  x.textAlign = 'center';
  x.fillStyle = 'rgba(255,255,255,0.55)';
  x.font = '700 34px -apple-system, BlinkMacSystemFont, sans-serif';
  x.fillText('NOW PLAYING', W / 2, 330);

  x.fillStyle = '#ffffff';
  x.font = '800 72px -apple-system, BlinkMacSystemFont, sans-serif';
  x.fillText(trunc(song.title, 20), W / 2, 1360);
  x.fillStyle = '#cfcfda';
  x.font = '500 44px -apple-system, BlinkMacSystemFont, sans-serif';
  x.fillText(trunc(song.subtitle, 30), W / 2, 1432);

  // Fake progress bar for the "live moment" feel — decorative, honest enough.
  const bw = 640;
  const bx = (W - bw) / 2;
  const by = 1530;
  x.fillStyle = 'rgba(255,255,255,0.18)';
  roundRect(x, bx, by, bw, 8, 4);
  x.fill();
  x.fillStyle = '#818cf8';
  roundRect(x, bx, by, bw * 0.38, 8, 4);
  x.fill();

  x.fillStyle = '#818cf8';
  x.font = '700 36px -apple-system, BlinkMacSystemFont, sans-serif';
  x.fillText('♫  Playing free on VinaX', W / 2, 1700);
  x.fillStyle = 'rgba(255,255,255,0.45)';
  x.font = '500 30px -apple-system, BlinkMacSystemFont, sans-serif';
  x.fillText('sirimillavinay.online', W / 2, 1756);

  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) return false;
  await shareOrSaveImage(blob, 'vinax-story.png', `${song.title} — VinaX`);
  return true;
}
