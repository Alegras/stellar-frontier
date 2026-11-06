/**
 * Локализация КОНТЕНТА (не chrome-интерфейса): переключает текстовые поля JSON-данных
 * между RU и EN прямо в загруженных объектах. UI вызывает applyContentLocale() перед
 * сменой локали и перерисовывается на key={locale}.
 *
 * Переводы — packages/data/src/l10n/content-en.auto.json (машинный перевод + вычитанные
 * overrides ключевых терминов). Ключ карты — trimmed RU-строка; многострочные тексты
 * переводятся построчно, поэтому переводы можно править независимо.
 */
import resourcesJson from "./resources.json";
import jobsJson from "./jobs.json";
import districtsJson from "./districts.json";
import buildingsJson from "./buildings.json";
import techsJson from "./techs.json";
import hullsJson from "./hulls.json";
import weaponsJson from "./weapons.json";
import modulesJson from "./modules.json";
import designsJson from "./designs.json";
import missionsJson from "./missions.json";
import namesJson from "./names.json";
import modeJson from "./mode.json";
import modeCoopJson from "./modes/coop.json";
import modeMmoJson from "./modes/mmo.json";
import modeSandboxJson from "./modes/sandbox.json";
import modeTrialJson from "./modes/trial.json";
import traditionsJson from "./full/traditions.json";
import perksJson from "./full/perks.json";
import techsExtraJson from "./full/techs-extra.json";
import megastructuresJson from "./full/megastructures.json";
import crisesJson from "./full/crises.json";
import resolutionsJson from "./full/resolutions.json";
import espionageJson from "./full/espionage.json";
import modesJson from "./full/modes.json";
import ethicsJson from "./full/ethics.json";
import governmentsJson from "./full/governments.json";
import civicsJson from "./full/civics.json";
import focusJson from "./full/focus-goals.json";
import actsJson from "./campaign/acts.json";
import campaignMissionsJson from "./campaign/missions.json";
import eventsJson from "./campaign/events.json";
import anomaliesJson from "./campaign/anomalies.json";
import archaeologyJson from "./campaign/archaeology.json";
import loreJson from "./campaign/lore.json";
import endingsJson from "./campaign/endings.json";
import branchesJson from "./campaign/branches.json";
import contentEn from "./l10n/content-en.auto.json";

export type ContentLocale = "ru" | "en";

const MAP = contentEn as Record<string, string>;
const CYR = /[\u0400-\u04FF]/;

/** Все корни данных, чьи текстовые поля участвуют в локализации контента. */
const ROOTS: unknown[] = [
  resourcesJson, jobsJson, districtsJson, buildingsJson, techsJson, hullsJson, weaponsJson,
  modulesJson, designsJson, missionsJson, namesJson, modeJson,
  modeCoopJson, modeMmoJson, modeSandboxJson, modeTrialJson,
  traditionsJson, perksJson, techsExtraJson, megastructuresJson, crisesJson, resolutionsJson,
  espionageJson, modesJson, ethicsJson, governmentsJson, civicsJson, focusJson,
  actsJson, campaignMissionsJson, eventsJson, anomaliesJson, archaeologyJson, loreJson,
  endingsJson, branchesJson,
];

let current: ContentLocale = "ru";
let originals: Array<{ container: Record<string, unknown> | unknown[]; key: string | number; original: string }> = [];

function translateLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return line;
  return MAP[trimmed] ?? line;
}

function translateString(value: string): string {
  if (!CYR.test(value)) return value;
  return value.split("\n").map(translateLine).join("\n");
}

function walk(node: unknown, seen: WeakSet<object>): void {
  if (Array.isArray(node)) {
    if (seen.has(node)) return;
    seen.add(node);
    for (let i = 0; i < node.length; i++) {
      const value = node[i];
      if (typeof value === "string") {
        const translated = translateString(value);
        if (translated !== value) {
          originals.push({ container: node, key: i, original: value });
          node[i] = translated;
        }
      } else if (value && typeof value === "object") {
        walk(value, seen);
      }
    }
    return;
  }
  if (node && typeof node === "object") {
    if (seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (typeof value === "string") {
        const translated = translateString(value);
        if (translated !== value) {
          originals.push({ container: record, key, original: value });
          record[key] = translated;
        }
      } else if (value && typeof value === "object") {
        walk(value, seen);
      }
    }
  }
}

/** Переключить тексты данных: "en" — сохранить RU и подставить EN, "ru" — восстановить. */
export function applyContentLocale(locale: ContentLocale): void {
  if (locale === current) return;
  if (locale === "en") {
    originals = [];
    const seen = new WeakSet<object>();
    for (const root of ROOTS) walk(root, seen);
    current = "en";
    return;
  }
  for (let i = originals.length - 1; i >= 0; i--) {
    const item = originals[i]!;
    if (Array.isArray(item.container)) item.container[item.key as number] = item.original;
    else item.container[item.key as string] = item.original;
  }
  originals = [];
  current = "ru";
}

export function getContentLocale(): ContentLocale {
  return current;
}

/** Сколько RU-строк данных имеют EN-перевод (для отчётов/тестов). */
export function contentTranslationStats(): { map: number; locale: ContentLocale } {
  return { map: Object.keys(MAP).length, locale: current };
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y",
  ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Транслитерация сгенерированных имён (системы/империи/станции/флоты) для EN-режима.
 * Данные имён процедурные, поэтому переводятся не словарём, а транслитерацией.
 */
export function transliterateRu(text: string): string {
  let out = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    const mapped = TRANSLIT[lower];
    if (mapped === undefined) {
      out += ch;
      continue;
    }
    if (ch !== lower && mapped.length > 0) out += mapped.charAt(0).toUpperCase() + mapped.slice(1);
    else out += mapped;
  }
  return out;
}
