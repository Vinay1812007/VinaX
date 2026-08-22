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
  x.fillStyle = '#ff8a4c';
  x.font = '700 30px -apple-system, BlinkMacSystemFont, sans-serif';
  x.fillText('♫  Playing on VinaX', 540, 1024);

  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) return false;
  await shareOrSaveImage(blob, 'vinax-song.png', `${song.title} — VinaX`);
  return true;
}
