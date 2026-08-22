import type { Song } from '@/types';
import { bestImage } from '@/utils/images';
import { extractAverageColor } from '@/utils/color';
import { isNativePlatform } from '@/services/native';

/**
 * Renders a square "now playing" share card (artwork + title + artist + a
 * faux waveform) to a PNG blob — pure canvas, no backend. Shares via Web
 * Share API (files) where supported, else downloads the PNG.
 */
export async function shareNowPlayingCard(song: Song): Promise<'shared' | 'downloaded' | 'failed'> {
  try {
    const size = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'failed';

    const artUrl = bestImage(song.images, 500);
    const accent = (await extractAverageColor(artUrl)) ?? 'rgb(30,22,53)';

    // Background gradient from album accent.
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, '#0a0714');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Artwork (rounded).
    const art = await loadArtwork(artUrl);
    const pad = 110;
    const artSize = size - pad * 2;
    if (art) {
      roundRect(ctx, pad, pad - 30, artSize, artSize, 36);
      ctx.save();
      ctx.clip();
      ctx.drawImage(art, pad, pad - 30, artSize, artSize);
      ctx.restore();
    }

    // Faux waveform strip.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const barY = pad - 30 + artSize + 70;
    const bars = 48;
    const bw = (size - pad * 2) / bars;
    for (let i = 0; i < bars; i++) {
      const h = 12 + Math.abs(Math.sin(i * 0.7)) * 60;
      ctx.fillRect(pad + i * bw, barY - h / 2, bw * 0.5, h);
    }

    // Title + artist.
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 58px system-ui, sans-serif';
    ctx.fillText(truncate(ctx, song.title, size - pad * 2), pad, barY + 110);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '400 38px system-ui, sans-serif';
    ctx.fillText(truncate(ctx, song.subtitle, size - pad * 2), pad, barY + 168);

    // Brand mark.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '700 32px system-ui, sans-serif';
    ctx.fillText('VinaX', pad, size - 70);

    let blob = await safeToBlob(canvas);
    if (!blob) {
      // Canvas likely tainted by a non-CORS artwork — redraw text-only.
      const c2 = document.createElement('canvas');
      c2.width = size; c2.height = size;
      const x2 = c2.getContext('2d');
      if (!x2) return 'failed';
      x2.fillStyle = grad; x2.fillRect(0, 0, size, size);
      x2.fillStyle = '#ffffff';
      x2.font = '700 58px system-ui, sans-serif';
      x2.fillText(truncate(x2, song.title, size - pad * 2), pad, size / 2);
      x2.fillStyle = 'rgba(255,255,255,0.7)';
      x2.font = '400 38px system-ui, sans-serif';
      x2.fillText(truncate(x2, song.subtitle, size - pad * 2), pad, size / 2 + 58);
      x2.fillStyle = 'rgba(255,255,255,0.55)';
      x2.font = '700 32px system-ui, sans-serif';
      x2.fillText('VinaX', pad, size - 70);
      blob = await safeToBlob(c2);
    }
    if (!blob) return 'failed';
    const file = new File([blob], `vinax-${song.id}.png`, { type: 'image/png' });

    // Each delivery path is independently guarded so a rejection (e.g.
    // navigator.share in incognito, or a blocked installer) NEVER fails the
    // whole card — we always fall through to a plain download.
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({ files: [file], title: song.title, text: `${song.title} — ${song.subtitle}` });
        return 'shared';
      } catch {
        /* user cancelled or unsupported — fall through */
      }
    }
    if (isNativePlatform()) {
      try {
        const [{ Filesystem, Directory }, { FileOpener }] = await Promise.all([
          import('@capacitor/filesystem'),
          import('@capacitor-community/file-opener'),
        ]);
        const dataUrl = canvas.toDataURL('image/png');
        await Filesystem.writeFile({ path: file.name, data: dataUrl.split(',')[1], directory: Directory.Cache });
        const { uri } = await Filesystem.getUri({ path: file.name, directory: Directory.Cache });
        await FileOpener.open({ filePath: uri, contentType: 'image/png' });
        return 'shared';
      } catch {
        /* fall through to download */
      }
    }
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
      return 'downloaded';
    } catch {
      // Last resort: open the image in a new tab so the user can long-press/save.
      try {
        window.open(canvas.toDataURL('image/png'), '_blank');
        return 'downloaded';
      } catch {
        return 'failed';
      }
    }
  } catch {
    return 'failed';
  }
}

function safeToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((res) => {
    try {
      canvas.toBlob((b) => res(b), 'image/png', 0.92);
    } catch {
      res(null); // SecurityError on tainted canvas
    }
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Loads artwork into a NON-tainting source: a same-origin Cloudflare image
 * proxy on web, or a base64 data URI via CapacitorHttp on native. Returns
 * null on any failure so the card still renders (without art).
 */
async function loadArtwork(url: string): Promise<HTMLImageElement | null> {
  try {
    if (isNativePlatform()) {
      const { CapacitorHttp } = await import('@capacitor/core');
      const res = await CapacitorHttp.get({ url, responseType: 'blob' });
      if (res.status !== 200 || typeof res.data !== 'string') return null;
      return await loadImage(`data:image/jpeg;base64,${res.data}`);
    }
    return await loadImage(`/img?url=${encodeURIComponent(url)}`);
  } catch {
    return null;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}
