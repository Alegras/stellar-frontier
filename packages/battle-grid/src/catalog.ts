import { BATTLE_ABILITIES, BATTLE_CLASSES, BATTLE_AI_PROFILES, BATTLE_SCENARIOS } from "@sf/data";
import type { AbilityDef, UnitClassDef } from "./types";

/** Внутренний контракт данных. Когда @sf/data/battles будет готов — setBattleContent() переопределит. */
export const DEFAULT_CLASSES: UnitClassDef[] = [
  { id:"corvette", code:"CV", nameRu:"Корвет", hp:310, dps:14, accuracyBp:8500, initiative:13, mp:7, atk:9, def:8, range:4, fp:6, maxStack:12, costAlloys:12, damageMix:{kinetic:0.6,energy:0.4}, abilities:["swarm"] },
  { id:"frigate", code:"FR", nameRu:"Фрегат", hp:590, dps:22, accuracyBp:8300, initiative:11, mp:6, atk:10, def:9, range:5, fp:13, maxStack:10, costAlloys:26, damageMix:{kinetic:0.6,energy:0.4}, abilities:["screen"] },
  { id:"destroyer", code:"DD", nameRu:"Эсминец", hp:1080, dps:40, accuracyBp:8200, initiative:10, mp:5, atk:12, def:10, range:5, fp:24, maxStack:8, costAlloys:48, damageMix:{kinetic:0.5,energy:0.5}, abilities:["torpedo_salvo"] },
  { id:"cruiser", code:"CA", nameRu:"Крейсер", hp:2150, dps:80, accuracyBp:8000, initiative:9, mp:4, atk:13, def:12, range:6, fp:55, maxStack:6, costAlloys:110, damageMix:{kinetic:0.4,energy:0.6}, abilities:["salvo"] },
  { id:"battleship", code:"BB", nameRu:"Линкор", hp:4450, dps:170, accuracyBp:7800, initiative:8, mp:3, atk:15, def:14, range:6, fp:130, maxStack:3, costAlloys:260, damageMix:{kinetic:0.7,energy:0.3}, abilities:["heavy_armor"] },
  { id:"titan", code:"TT", nameRu:"Титан", hp:10400, dps:300, accuracyBp:7600, initiative:6, mp:2, atk:17, def:17, range:6, fp:300, maxStack:2, costAlloys:600, damageMix:{kinetic:0.5,energy:0.5}, abilities:["command_aura"] },
  { id:"carrier", code:"CVN", nameRu:"Носитель", hp:5500, dps:90, accuracyBp:7800, initiative:7, mp:3, atk:12, def:11, range:7, fp:160, maxStack:2, costAlloys:320, damageMix:{kinetic:0.4,energy:0.6}, abilities:["hangar"] },
  { id:"colossus", code:"CL", nameRu:"Колосс", hp:6700, dps:20, accuracyBp:7400, initiative:5, mp:2, atk:6, def:16, range:3, fp:60, maxStack:1, costAlloys:120, damageMix:{kinetic:0.3,energy:0.7}, abilities:["siege"] },
];

export const DEFAULT_ABILITIES: AbilityDef[] = [
  { id:"focus_fire", nameRu:"Сосредоточенный залп", kind:"active", source:"admiral", costOk:1, cooldown:2, target:"self", effect:{damageMult:0.5,durationRounds:1} },
  { id:"emergency_repair", nameRu:"Экстренный ремонт", kind:"active", source:"admiral", costOk:2, cooldown:3, target:"self", effect:{healPct:0.10,oncePerBattle:true} },
  { id:"ew_jam", nameRu:"РЭБ-помехи", kind:"active", source:"admiral", costOk:2, cooldown:3, target:"enemy", effect:{initiative:-2,damageMult:-0.20,durationRounds:1} },
  { id:"torpedo_fan", nameRu:"Торпедный веер", kind:"active", source:"admiral", costOk:3, cooldown:4, target:"line", effect:{damageMult:0.6,maxTargets:3} },
  { id:"shield_barrier", nameRu:"Щитовой барьер", kind:"active", source:"admiral", costOk:1, cooldown:2, target:"self", effect:{defMult:0.30,durationRounds:1} },
  { id:"interceptors", nameRu:"Дроны-перехватчики", kind:"active", source:"admiral", costOk:2, cooldown:3, target:"self", effect:{incomingMult:-0.40,durationRounds:1} },
  { id:"tactical_retreat", nameRu:"Тактический отход", kind:"active", source:"admiral", costOk:1, cooldown:3, target:"self", effect:{moveHexes:2,noRetaliation:true} },
  { id:"reserve", nameRu:"Резерв", kind:"active", source:"admiral", costOk:2, cooldown:2, target:"reserve", effect:{deployReserve:true} },
  { id:"boarding", nameRu:"Абордаж", kind:"active", source:"admiral", costOk:2, cooldown:99, target:"enemy", effect:{boardingBonus:0.20,oncePerBattle:true} },
  { id:"reactor_overload", nameRu:"Перегрузка реактора", kind:"active", source:"admiral", costOk:2, cooldown:5, target:"all_allies", effect:{damageMult:0.25,defMult:-0.10,durationRounds:1} },
  { id:"veteran", nameRu:"Ветеран", kind:"passive", source:"admiral", effect:{atkMult:0.05} },
  { id:"logist", nameRu:"Логист", kind:"passive", source:"admiral", effect:{mpBonus:1} },
  { id:"shieldsmith", nameRu:"Щитовик", kind:"passive", source:"admiral", effect:{hpMult:0.10} },
  { id:"sniper", nameRu:"Снайпер", kind:"passive", source:"admiral", effect:{rangeBonus:1} },
  { id:"fortitude", nameRu:"Стойкость", kind:"passive", source:"admiral", effect:{moraleBonus:1} },
  { id:"tactician", nameRu:"Тактик", kind:"passive", source:"admiral", effect:{okPerRound:1} },
  { id:"swarm", nameRu:"Рой", kind:"passive", source:"class", effect:{evasion:0.15} },
  { id:"screen", nameRu:"Скрин", kind:"passive", source:"class", effect:{screen:true} },
  { id:"torpedo_salvo", nameRu:"Торпедный залп", kind:"passive", source:"class", effect:{damageMult:1.0,oncePerBattle:true} },
  { id:"salvo", nameRu:"Ударный залп", kind:"passive", source:"class", effect:{stationaryDamageMult:0.25} },
  { id:"heavy_armor", nameRu:"Тяжёлая броня", kind:"passive", source:"class", effect:{kineticResist:0.20} },
  { id:"command_aura", nameRu:"Аура командования", kind:"passive", source:"class", effect:{auraAtk:0.10,radius:2} },
  { id:"hangar", nameRu:"Ангар", kind:"passive", source:"class", effect:{droneEveryRounds:3} },
  { id:"siege", nameRu:"Осадное орудие", kind:"passive", source:"class", effect:{stationaryDamageMult:2.0} },
];

function mapClass(c: (typeof BATTLE_CLASSES)[number]): UnitClassDef {
  return {
    id: c.id, code: c.code, nameRu: c.titleRu, hp: c.hpPerHull, dps: c.dpsPerHull,
    accuracyBp: 8000, initiative: c.initiative, mp: c.mp, atk: c.atk, def: c.def,
    range: c.range, fp: c.fp, maxStack: c.maxStack, costAlloys: Math.max(1, Math.round(c.fp * 2)),
    damageMix: { kinetic: 0.6, energy: 0.4 }, abilities: [c.passiveAbilityId],
  };
}
function mapAbility(a: (typeof BATTLE_ABILITIES)[number]): AbilityDef {
  const targetMap: Record<string, AbilityDef["target"]> = {
    self: "self", enemy_stack: "enemy", line: "line", all_allies: "all_allies", reserve: "reserve",
  };
  return {
    id: a.id, nameRu: a.titleRu, kind: a.kind, source: a.source,
    costOk: a.costOk, cooldown: a.cooldownRounds, target: targetMap[a.targeting.type] ?? "self",
    effect: a.effect as AbilityDef["effect"],
  };
}
let classes: UnitClassDef[] = BATTLE_CLASSES.length ? BATTLE_CLASSES.map(mapClass) : DEFAULT_CLASSES;
let abilities: AbilityDef[] = BATTLE_ABILITIES.length ? BATTLE_ABILITIES.map(mapAbility) : DEFAULT_ABILITIES;
export const BATTLE_CONTENT = {
  classes,
  abilities,
  profiles: BATTLE_AI_PROFILES,
  scenarios: BATTLE_SCENARIOS,
};
export function setBattleContent(content: { classes?: UnitClassDef[]; abilities?: AbilityDef[] }): void {
  if (content.classes?.length) classes = content.classes;
  if (content.abilities?.length) abilities = content.abilities;
}
export function battleClasses(): UnitClassDef[] { return classes; }
export function battleAbilities(): AbilityDef[] { return abilities; }
export function classById(id: string): UnitClassDef | undefined { return classes.find((c) => c.id === id); }
export function abilityById(id: string): AbilityDef | undefined { return abilities.find((a) => a.id === id); }
