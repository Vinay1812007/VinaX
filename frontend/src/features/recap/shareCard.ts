import type { RecapData } from './recap';
import { languageLabel } from '@/constants/languages';

/**
 * Renders the shareable 1080×1920 recap card on a local <canvas> — a plain
 * PNG the listener can send anywhere. Pure client pixels: no fonts fetched,
 * no upstream calls, nothing leaves the device until THEY hit share.
 */
export function renderRecapCard(r: RecapData, name: string): Promise<Blob> {
  const W = 1080;
  const H = 1920;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  if (!x) return Promise.reject(new Error('canvas unavailable'));

  // Canvas — deep ink gradient with two soft accent glows.
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b0c18');
  bg.addColorStop(1, '#141230');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  const glow = (cx: number, cy: number, rad: number, color: string): void => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  };
  glow(W * 0.85, H * 0.12, 620, 'rgba(99,102,241,0.32)');
  glow(W * 0.1, H * 0.85, 700, 'rgba(45,212,191,0.16)');

  const F = (weight: number, px: number): string => `${weight} ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  const ink = (a: number): string => `rgba(240,242,248,${a})`;

  // Header
  x.fillStyle = ink(1);
  x.font = F(800, 64);
  x.fillText('VinaX', 84, 150);
  x.fillStyle = '#818cf8';
  x.font = F(800, 44);
  x.fillText(`${r.year} · Year in Music`, 84, 224);
  if (name) {
    x.fillStyle = ink(0.72);
    x.font = F(700, 40);
    x.fillText(name.slice(0, 24), 84, 292);
  }

  // Persona
  x.fillStyle = ink(0.55);
  x.font = F(700, 34);
  x.fillText('YOUR LISTENING PERSONA', 84, 420);
  x.fillStyle = '#5eead4';
  x.font = F(800, 76);
  x.fillText(r.persona, 84, 512);

  // Big numbers
  const stat = (label: string, value: string, y: number): void => {
    x.fillStyle = ink(1);
    x.font = F(800, 96);
    x.fillText(value, 84, y);
    x.fillStyle = ink(0.55);
    x.font = F(700, 36);
    x.fillText(label, 84, y + 54);
  };
  stat('songs played', String(r.totalPlays), 700);
  stat('minutes of music (about)', `≈${r.estMinutes.toLocaleString('en-IN')}`, 900);
  stat('days of music together', String(r.daysTogether), 1100);

  // Top artists — track the real bottom so the languages block can never
  // collide with the footer when the list is short (or vice versa when full).
  x.fillStyle = ink(0.55);
  x.font = F(700, 34);
  x.fillText('TOP ARTISTS', 84, 1250);
  x.font = F(800, 52);
  const shown = r.topArtists.slice(0, 5);
  shown.forEach((a, i) => {
    x.fillStyle = i === 0 ? '#f7a94f' : ink(0.92);
    x.fillText(`${i + 1}. ${a.name.slice(0, 26)}`, 84, 1330 + i * 78);
  });
  const artistsBottom = 1330 + Math.max(shown.length - 1, 0) * 78;

  // Languages
  if (r.topLanguages.length) {
    x.fillStyle = ink(0.55);
    x.font = F(700, 34);
    x.fillText('YOUR LANGUAGES', 84, artistsBottom + 84);
    x.fillStyle = ink(0.92);
    x.font = F(800, 46);
    const line = r.topLanguages.map((l) => `${languageLabel(l.id)} ${l.pct}%`).join(' · ');
    x.fillText(line.slice(0, 44), 84, artistsBottom + 152);
  }

  // Footer
  x.fillStyle = ink(0.45);
  x.font = F(700, 32);
  x.fillText('sirimillavinay.online — free forever · private by design', 84, H - 56);

  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
