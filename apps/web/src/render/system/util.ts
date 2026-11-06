/**
 * Мелкие математические хелперы сцены полёта.
 * (Числа-константы формул живут рядом с местом применения, см. комментарии.)
 */

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Экспоненциальное сглаживание, независимое от FPS. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Детерминированный хеш 0..1 (для раскраски граней/точек, без Math.random). */
export function hash01(n: number): number {
  let x = (n | 0) * 0x9e3779b1;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Защита телеметрии от NaN/Infinity (HUD не должен показывать «не число»). */
export function safeNum(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** «1.2 Мм», «840 м», «12,4 км» — для подсказок и контактов. */
export function formatDist(meters: number): string {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} м`;
  if (meters < 1_000_000) return `${(meters / 1000).toFixed(1).replace(".", ",")} км`;
  return `${(meters / 1_000_000).toFixed(2).replace(".", ",")} Мм`;
}
