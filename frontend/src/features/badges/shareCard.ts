import type { BadgeDef } from './catalog';

/**
 * The shareable 1080×1080 badge card, painted on a local <canvas>: the
 * glyph in a tinted disc, the badge's name, how it was earned, the day and
 * the listener's name. Pure client pixels; nothing leaves the device until
 * they hit share.
 */
export function renderBadgeCard(badge: BadgeDef, earnedAt: string | null, name: string): Promise<Blob> {
  const W = 1080;
  const H = 1080;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  if (!x) return Promise.reject(new Error('canvas unavailable'));

  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#130e16');
  bg.addColorStop(1, `hsl(${badge.hue} 40% 16%)`);
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, 430, 0, W / 2, 430, 520);
  glow.addColorStop(0, `hsl(${badge.hue} 90% 60% / 0.38)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);

  const F = (weight: number, px: number): string => `${weight} ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  const ink = (a: number): string => `rgba(251,245,236,${a})`;

  x.fillStyle = ink(1);
  x.font = F(800, 56);
  x.textAlign = 'left';
  x.fillText('VinaX', 84, 128);
  x.fillStyle = `hsl(${badge.hue} 90% 72%)`;
  x.font = F(800, 36);
  x.fillText('BADGE EARNED', 84, 186);

  // The disc and the glyph.
  x.beginPath();
  x.arc(W / 2, 430, 190, 0, Math.PI * 2);
  x.fillStyle = `hsl(${badge.hue} 70% 50% / 0.22)`;
  x.fill();
  x.lineWidth = 10;
  x.strokeStyle = `hsl(${badge.hue} 90% 66%)`;
  x.stroke();
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = F(500, 180);
  x.fillStyle = ink(1);
  x.fillText(badge.glyph, W / 2, 440);

  x.textBaseline = 'alphabetic';
  x.fillStyle = ink(1);
  x.font = F(800, 84);
  x.fillText(badge.name.slice(0, 22), W / 2, 760);
  x.fillStyle = ink(0.72);
  x.font = F(600, 40);
  x.fillText(badge.blurb.slice(0, 52), W / 2, 830);

  const when = earnedAt ? new Date(`${earnedAt}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const who = name ? name.slice(0, 24) : '';
  const line = [who, when].filter(Boolean).join(' · ');
  if (line) {
    x.fillStyle = `hsl(${badge.hue} 90% 72%)`;
    x.font = F(700, 38);
    x.fillText(line, W / 2, 920);
  }

  x.fillStyle = ink(0.45);
  x.font = F(700, 30);
  x.fillText('vinaxmusic.online — free forever · private by design', W / 2, H - 56);

  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
