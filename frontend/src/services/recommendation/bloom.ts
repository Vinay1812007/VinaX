/**
 * A Bloom filter for the lifetime heard-set (./heardSet.ts): "has this
 * listener ever heard this song?" answered from memory in constant time,
 * however many songs the set holds.
 *
 * A Bloom filter never says "no" to a key it was given (no false negatives),
 * and says "yes" to a key it was never given with a small, bounded
 * probability (the false-positive rate). For Never repeat that trade is the
 * right way round: a song the listener heard is always kept out, and about
 * one never-heard song in a hundred is passed over, which the pool absorbs.
 *
 * Sizing for n keys at false-positive rate p: m = −n·ln p / (ln 2)² bits and
 * k = (m / n)·ln 2 hash functions. At p = 0.01 that is about 9.6 bits and 7
 * hashes per key, so 50 000 songs cost about 60 KB.
 */

/** 32-bit FNV-1a with a seed: two seeds give the two base hashes for double hashing. */
function fnv1a(text: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // A final avalanche so short keys spread across the whole word.
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

export interface BloomShape {
  bits: number;
  hashes: number;
}

/** Bits and hash count for `capacity` keys at `fpRate`. */
export function bloomShape(capacity: number, fpRate: number): BloomShape {
  const n = Math.max(1, Math.floor(capacity));
  const p = Math.min(0.5, Math.max(1e-6, fpRate));
  const bits = Math.max(64, Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2)));
  const hashes = Math.max(1, Math.round((bits / n) * Math.LN2));
  return { bits, hashes };
}

export class BloomFilter {
  readonly capacity: number;
  readonly fpRate: number;
  readonly bits: number;
  readonly hashes: number;
  private readonly words: Uint32Array;
  private added = 0;

  constructor(capacity: number, fpRate = 0.01) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.fpRate = fpRate;
    const shape = bloomShape(this.capacity, fpRate);
    this.bits = shape.bits;
    this.hashes = shape.hashes;
    this.words = new Uint32Array(Math.ceil(this.bits / 32));
  }

  /** Keys added so far (repeats included: the filter cannot tell them apart). */
  get count(): number {
    return this.added;
  }

  /** True once more keys went in than the filter was sized for: the false-positive rate is climbing. */
  get full(): boolean {
    return this.added > this.capacity;
  }

  private positions(key: string): number[] {
    const h1 = fnv1a(key, 0x9747b28c);
    // An odd step never cycles early on any table size.
    const h2 = fnv1a(key, 0x85ebca6b) | 1;
    const out: number[] = [];
    for (let i = 0; i < this.hashes; i += 1) out.push(((h1 + Math.imul(i, h2)) >>> 0) % this.bits);
    return out;
  }

  add(key: string): void {
    for (const bit of this.positions(key)) this.words[bit >>> 5] |= 1 << (bit & 31);
    this.added += 1;
  }

  has(key: string): boolean {
    for (const bit of this.positions(key)) if ((this.words[bit >>> 5] & (1 << (bit & 31))) === 0) return false;
    return true;
  }
}
