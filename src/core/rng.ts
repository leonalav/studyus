/**
 * Seeded, reproducible RNG — §10.3. Generation is seeded and reproducible:
 * tests use a fixed seed.
 */

export interface Rng {
  /** uniform int in [min, max] inclusive */
  int(min: number, max: number): number;
  pick<T>(items: T[]): T;
}

/** mulberry32 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
  };
}
