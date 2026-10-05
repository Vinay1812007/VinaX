/** Original letter-avatar artwork for artists without images. */
// 10.0 Marigold: marigold, rose, coral, plum, turmeric.
const PALETTE = ['#ffa42e', '#ff6384', '#ff886a', '#c58ad2', '#e2b23a'];

export function letterAvatar(name: string): string {
  const letter = (name.trim()[0] ?? '♪').toUpperCase();
  const color = PALETTE[Math.abs([...name].reduce((a, c) => a + c.charCodeAt(0), 0)) % PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" fill="#251c2a"/><circle cx="64" cy="64" r="44" fill="${color}" opacity="0.2"/><text x="64" y="64" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-weight="700" font-size="56" fill="${color}">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
