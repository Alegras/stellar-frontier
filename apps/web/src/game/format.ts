import type { ResourceId, Resources } from "@sf/sim";
import { RESOURCE_BY_ID } from "@sf/data";

export function fmtInt(n: number): string {
  const r = Math.round(n);
  return r.toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}

export function fmtSigned(n: number, digits = 0): string {
  const v = digits === 0 ? Math.round(n) : Number(n.toFixed(digits));
  const s = Math.abs(v).toLocaleString("ru-RU").replace(/\u00a0/g, " ");
  if (v > 0) return "+" + s;
  if (v < 0) return "−" + s;
  return "0";
}

export function fmtMilli(milli: number): string {
  const v = milli / 1000;
  return (Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v).toString()).replace(".", ",");
}

export function fmtCredits(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + " млрд";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + " млн";
  if (Math.abs(n) >= 10_000) return Math.round(n / 1000) + " тыс";
  return fmtInt(n);
}

export function resourceLabel(id: ResourceId): string {
  return RESOURCE_BY_ID[id]?.ru ?? id;
}

export function resourceIcon(id: ResourceId): string {
  return RESOURCE_BY_ID[id]?.icon ?? "?";
}

export function resourceColor(id: ResourceId): string {
  return RESOURCE_BY_ID[id]?.color ?? "#E8EEF7";
}

export function totalOf(res: Partial<Resources>): number {
  return Object.values(res).reduce((a, b) => a + (b ?? 0), 0);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function pct(v01: number): string {
  return Math.round(v01 * 100) + "%";
}
