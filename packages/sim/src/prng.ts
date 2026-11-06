/** xoshiro128** — детерминированный PRNG. Состояние сериализуется в World.rngState. */
export type RngState = [number, number, number, number];

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    t = (t ^ (t >>> 15)) >>> 0;
    return t >>> 0;
  };
}

export function seedRng(seed: number): RngState {
  const sm = splitmix32(seed >>> 0);
  const s: RngState = [sm(), sm(), sm(), sm()];
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1;
  return s;
}

/** Возвращает uint32 и мутирует состояние. */
export function nextU32(s: RngState): number {
  const result = (Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0);
  const t = (s[1] << 9) >>> 0;
  s[2] ^= s[0];
  s[3] ^= s[1];
  s[1] ^= s[2];
  s[0] ^= s[3];
  s[2] ^= t;
  s[3] = rotl(s[3], 11);
  s[0] >>>= 0; s[1] >>>= 0; s[2] >>>= 0; s[3] >>>= 0;
  return result;
}

/** [0,1) — только для визуальных/небалансных решений; баланс — целочисленный. */
export function nextFloat(s: RngState): number {
  return nextU32(s) / 4294967296;
}

/** Целое [0, n). */
export function nextInt(s: RngState, n: number): number {
  if (n <= 0) return 0;
  return Math.floor((nextU32(s) / 4294967296) * n);
}

/** Целое [min, max] включительно. */
export function nextRange(s: RngState, min: number, max: number): number {
  return min + nextInt(s, max - min + 1);
}

export function pick<T>(s: RngState, arr: readonly T[]): T {
  return arr[nextInt(s, arr.length)];
}

/** Детерминированный хэш пары значений для дисперсии авторезолва (GDD §11.6 шаг 7). */
export function hash32(seed: number, ...vals: number[]): number {
  let h = seed >>> 0;
  for (const v of vals) {
    h = (Math.imul(h ^ (v >>> 0), 0x01000193) + 0x811c9dc5) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}
