/**
 * Детерминированный PRNG (mulberry32).
 * Геймплей не должен зависеть от Math.random (канон: детерминизм), поэтому вся
 * косметика сцены (звёзды, астероиды, туманности, детали кораблей) — из seeded RNG.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxExclusive: number): number {
    return min + Math.floor(this.next() * (maxExclusive - min));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
}
