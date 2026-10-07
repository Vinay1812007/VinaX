/**
 * Festival emblems (11.0) — original drawn art, no photographs.
 *
 * Each emblem is the inner markup of a 64×64 SVG in a paper-cut style and
 * uses only five classes, coloured by whoever renders it:
 *   .a .b .c  filled shapes in the festival's first / second / third colour
 *   .s .t     line work in the first / second colour
 * The app colours them from the skin's CSS variables (see festivals.css);
 * the generator inlines hex colours to build the owner console's previews.
 * Pure data on purpose: it is imported only by the lazily loaded splash and
 * Home banner, so none of it reaches the first-load bundle.
 */
const rot = (n: number, body: string, step = 360 / n): string =>
  Array.from({ length: n }, (_, i) => `<g transform="rotate(${+(i * step).toFixed(2)} 32 32)">${body}</g>`).join('');

export const EMBLEMS = {
  lamp: '<path class="a" d="M32 6c5 7 7 11 7 15a7 7 0 0 1-14 0c0-4 2-8 7-15z"/><path class="c" d="M32 15c2 3 3 5 3 7a3 3 0 0 1-6 0c0-2 1-4 3-7z"/><path class="b" d="M8 34h48c0 12-10 20-24 20S8 46 8 34z"/><path class="t" d="M16 40c5 5 27 5 32 0M24 58h16"/>',
  kite: '<path class="a" d="M32 4 52 26 32 48 12 26z"/><path class="b" d="M32 4 52 26H32z"/><path class="c" d="M32 26v22L12 26z"/><path class="s" d="M32 48c-6 4 6 6 0 10s4 4 0 4"/><path class="b" d="m26 52 5 2-5 3zM38 57l-5 2 5 3z"/>',
  burst: `${rot(8, '<path class="a" d="M32 6c3 6 3 10 0 14-3-4-3-8 0-14z"/>')}${rot(8, '<circle class="b" cx="32" cy="12" r="2.6"/>', 45).replace(/rotate\((\S+)/g, (_, d) => `rotate(${+d + 22.5}`)}<circle class="c" cx="32" cy="32" r="9"/><circle class="a" cx="32" cy="32" r="4"/>`,
  crescent: '<path class="a" d="M40 8a25 25 0 1 0 14 38A20 20 0 0 1 40 8z"/><path class="b" d="m46 20 2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z"/><circle class="c" cx="20" cy="14" r="1.6"/><circle class="c" cx="56" cy="50" r="1.6"/>',
  lotus: '<path class="b" d="M6 36c10-2 18 2 26 14-12 2-22-2-26-14zM58 36c-10-2-18 2-26 14 12 2 22-2 26-14z"/><path class="a" d="M16 22c8 4 13 12 16 28-10-4-16-14-16-28zM48 22c-8 4-13 12-16 28 10-4 16-14 16-28z"/><path class="c" d="M32 12c6 8 8 20 0 38-8-18-6-30 0-38z"/><path class="t" d="M12 56c12 4 28 4 40 0"/>',
  chakra: `<circle class="s" cx="32" cy="32" r="25"/>${rot(24, '<path class="s" d="M32 26V9"/>')}${rot(24, '<circle class="b" cx="32" cy="7" r="1.3"/>')}<circle class="a" cx="32" cy="32" r="5"/>`,
  tree: '<path class="b" d="m32 2 2 4.6 5 .5-3.8 3.3 1.2 4.8L32 12.6l-4.4 2.6 1.2-4.8L25 7.1l5-.5z"/><path class="a" d="M32 12 44 28h-6l10 12h-7l11 12H12l11-12h-7l10-12h-6z"/><path class="c" d="M28 52h8v8h-8z"/><circle class="b" cx="27" cy="34" r="2.2"/><circle class="c" cx="38" cy="45" r="2.2"/><circle class="b" cx="22" cy="48" r="2.2"/>',
  pumpkin: '<path class="b" d="M30 8h5v10h-5z"/><path class="a" d="M32 16c18 0 26 10 26 20S48 56 32 56 6 46 6 36s8-20 26-20z"/><path class="t" d="M22 18c-6 10-6 26 0 36M42 18c6 10 6 26 0 36"/><path class="c" d="m18 30 8 2-7 5zM46 30l-8 2 7 5zM18 42l5 2 4-2 5 3 5-3 4 2 5-2c-3 8-25 8-28 0z"/>',
  feather: '<path class="s" d="M32 62V30"/><path class="a" d="M32 2c14 10 16 30 0 44C16 32 18 12 32 2z"/><path class="b" d="M32 12c8 7 9 18 0 26-9-8-8-19 0-26z"/><ellipse class="c" cx="32" cy="25" rx="5" ry="7"/><circle class="a" cx="32" cy="24" r="2.4"/>',
  kalash: '<path class="b" d="M22 20c-5-5-6-10-4-14 5 2 8 6 9 12zM42 20c5-5 6-10 4-14-5 2-8 6-9 12z"/><path class="c" d="M32 4c5 5 6 11 3 16h-6c-3-5-2-11 3-16z"/><path class="a" d="M24 20h16v5c10 4 14 10 14 17 0 10-9 16-22 16s-22-6-22-16c0-7 4-13 14-17z"/><path class="t" d="M13 38c12 5 26 5 38 0M22 60h20"/>',
  bow: '<path class="s" d="M14 6c26 6 36 22 36 26S40 52 14 58" stroke-width="4"/><path class="t" d="M14 6v52"/><path class="a" d="M8 30h40v4H8z"/><path class="b" d="m60 32-13-8v16z"/><path class="c" d="m4 26 8 6-8 6z"/>',
  mandala: `${rot(8, '<path class="a" d="M32 4c5 6 5 12 0 16-5-4-5-10 0-16z"/>')}${rot(8, '<path class="b" d="M32 17c3 3 3 7 0 9-3-2-3-6 0-9z"/>', 45).replace(/rotate\((\S+)/g, (_, d) => `rotate(${+d + 22.5}`)}<circle class="s" cx="32" cy="32" r="29"/><circle class="c" cx="32" cy="32" r="5"/>`,
  lantern: '<path class="s" d="M32 2v8"/><path class="b" d="M24 10h16l3 6H21z"/><path class="a" d="M21 16h22c5 8 5 22 0 30H21c-5-8-5-22 0-30z"/><path class="c" d="M30 22h4c2 5 2 13 0 18h-4c-2-5-2-13 0-18z"/><path class="b" d="M22 46h20l-3 6H25z"/><path class="t" d="M32 52v10M27 54v6M37 54v6"/>',
  firework: `${rot(12, '<path class="s" d="M32 24V10"/>')}${rot(12, '<circle class="b" cx="32" cy="6" r="2"/>')}${rot(6, '<path class="c" d="M32 26l2 3-2 3-2-3z" transform="translate(0 -8)"/>', 60)}<circle class="a" cx="32" cy="32" r="4"/><path class="t" d="M32 44c-2 6 2 8 0 16"/>`,
  book: '<path class="a" d="M4 14c10-4 20-3 28 3v40c-8-6-18-7-28-3z"/><path class="b" d="M60 14c-10-4-20-3-28 3v40c8-6 18-7 28-3z"/><path class="t" d="M10 24c6-1 11 0 16 3M10 33c6-1 11 0 16 3"/><path class="c" d="M44 4h8v22l-4-4-4 4z"/>',
  heart: '<path class="a" d="M32 56C12 42 6 32 6 22a13 13 0 0 1 26-4 13 13 0 0 1 26 4c0 10-6 20-26 34z"/><path class="b" d="M32 44c-9-7-12-12-12-17a6 6 0 0 1 12-2 6 6 0 0 1 12 2c0 5-3 10-12 17z"/><circle class="c" cx="50" cy="10" r="2"/><circle class="c" cx="10" cy="48" r="2"/>',
  rakhi: `<path class="t" d="M2 32c8-6 12 6 20 0M42 32c8-6 12 6 20 0" stroke-width="3"/>${rot(10, '<path class="b" d="M32 14c3 3 3 6 0 8-3-2-3-5 0-8z"/>')}<circle class="a" cx="32" cy="32" r="10"/><circle class="c" cx="32" cy="32" r="4.5"/>`,
  cone: '<path class="c" d="M12 54h40l-3 6H15z"/><path class="a" d="M14 46h36l2 8H12z"/><path class="b" d="M18 38h28l3 8H15z"/><path class="c" d="M22 30h20l3 8H19z"/><path class="a" d="M25 22h14l3 8H22z"/><path class="b" d="M28 14h8l3 8H25z"/><path class="a" d="M32 3c4 4 4 8 0 11-4-3-4-7 0-11z"/>',
  sun: `<path class="a" d="M12 40a20 20 0 0 1 40 0z"/>${rot(7, '<path class="s" d="M32 14V6"/>', 30).replace(/rotate\((\S+)/g, (_, d) => `rotate(${+d - 90}`).replace(/ 32 32/g, ' 32 40')}<path class="t" d="M4 46c6-4 10 4 16 0s10 4 16 0 10 4 16 0 6 2 8 0M10 55c6-4 10 4 16 0s10 4 16 0 8 3 12 0"/><path class="c" d="M22 40a10 10 0 0 1 20 0z"/>`,
  leaves: '<path class="t" d="M2 8c20 8 40 8 60 0" stroke-width="3"/><path class="a" d="M12 12c5 10 5 22 0 34-5-12-5-24 0-34zM32 15c5 10 5 24 0 38-5-14-5-28 0-38zM52 12c5 10 5 22 0 34-5-12-5-24 0-34z"/><path class="b" d="M22 14c4 8 4 18 0 28-4-10-4-20 0-28zM42 14c4 8 4 18 0 28-4-10-4-20 0-28z"/><circle class="c" cx="22" cy="48" r="3"/><circle class="c" cx="42" cy="48" r="3"/>',
  trident: '<path class="a" d="M30 22h4v40h-4z"/><path class="a" d="M32 2c4 6 4 14 0 22-4-8-4-16 0-22z"/><path class="s" d="M12 8c-2 14 6 20 20 20s22-6 20-20" stroke-width="4"/><path class="b" d="M22 34h20v4H22z"/><path class="c" d="M14 50a18 18 0 0 0 14-10 14 14 0 0 1-14 10z"/>',
  flag: '<path class="t" d="M14 4v58" stroke-width="3"/><path class="a" d="M16 6c16 2 28 8 42 22-16 2-28 0-42-6z"/><path class="b" d="M16 26c10 2 18 6 26 14-10 0-18-2-26-6z"/><circle class="c" cx="28" cy="16" r="3"/>',
  flower: `${rot(6, '<path class="a" d="M32 6c7 6 7 16 0 22-7-6-7-16 0-22z"/>')}${rot(6, '<path class="b" d="M32 18c3 3 3 7 0 10-3-3-3-7 0-10z"/>', 60).replace(/rotate\((\S+)/g, (_, d) => `rotate(${+d + 30}`)}<circle class="c" cx="32" cy="32" r="5"/>`,
} as const;

export type EmblemId = keyof typeof EMBLEMS;

/** A standalone SVG document with concrete colours (owner console previews, tests). */
export function emblemSvg(id: EmblemId, [c1, c2 = c1, c3 = c2]: string[]): string {
  const css = `.a{fill:${c1}}.b{fill:${c2}}.c{fill:${c3}}.s,.t{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.s{stroke:${c1}}.t{stroke:${c2}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>${css}</style>${EMBLEMS[id]}</svg>`;
}
