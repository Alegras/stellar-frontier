import { useMemo, useState } from "react";
import { HULLS, MODULES, WEAPONS } from "@sf/data";
import type { HullDef, ModuleDef, ShipDesignDef, WeaponDef } from "@sf/data";
import type { Command, World } from "@sf/sim";
import * as sf from "@sf/sim";
import { Badge, Btn, Field, KV, Panel, Sep, Tip } from "./controls";
import { L, send, tr, type FullPanelProps } from "./fg";
import { canAfford, costText, intText, playerEmpire, rnd, worldOf } from "./util";

// ---------------------------------------------------------------- адаптер sim (task-20)
interface DesignStats {
  mass: number; maxMass: number; powerUse: number; powerMax: number;
  heat: number; fleetPower: number; costAlloys: number; costCredits: number; buildTicks: number;
}
interface ValidateResult { ok: boolean; errors: { code: string; messageRu: string }[]; stats: DesignStats }
interface DesignDraft { nameRu: string; hullId: string; weapons: string[]; modules: string[] }

interface DesignInput { nameRu: string; hullId: string; weapons: string[]; modules: string[] }
interface DesignError { code: string; messageRu: string }
interface DesignValidation {
  ok: boolean;
  errors: DesignError[];
  warnings: DesignError[];
  stats: { mass: number; maxMass: number; powerUse: number; powerMax: number; heat: number; fleetPower: number; costAlloys: number; costCredits: number; buildTicks: number };
  requiredTechs?: string[];
}
interface AvailableParts { hulls: HullDef[]; weapons: WeaponDef[]; modules: ModuleDef[] }
const simApi = sf as unknown as {
  getAvailableShipParts?: (world: World, empireId: number) => AvailableParts;
  getDesignPreview?: (world: World, empireId: number, input: DesignInput) => {
    ok: boolean; errorsRu: string[]; warningsRu: string[];
    stats: { fleetPower: number; costAlloys: number; costCredits: number; buildTicks: number; mass: number; powerDraw: number; powerOutput: number; heatNet: number; slotsUsed: unknown; requiredTechs: string[] };
  };
  getCustomDesigns?: (world: World, empireId: number) => ShipDesignDef[];
  validateShipDesign?: (world: World, empireId: number, draft: DesignDraft) => DesignValidation;
};

interface DesignRow { id: string; label: string; classId: string; fleetPower: number; costAlloys: number; hullId?: string; }

function savedDesigns(world: World, empireId: number): DesignRow[] {
  const fgAny = (world as unknown as { fg?: Record<string, unknown> }).fg;
  const fromHelper = simApi.getCustomDesigns?.(world, empireId);
  const candidates = [
    fromHelper,
    (world as unknown as { customDesigns?: unknown }).customDesigns,
    fgAny?.customDesigns, fgAny?.designs, fgAny?.shipDesigns,
  ];
  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    return (c as Record<string, unknown>[]).map((d) => {
      const hullId = String(d.hullId ?? "");
      const hullDef = HULLS.find((h) => h.id === hullId);
      return {
        id: String(d.id ?? ""),
        label: String(d.ru ?? d.nameRu ?? d.id ?? "Дизайн"),
        classId: String(d.classId ?? hullDef?.classId ?? "—"),
        fleetPower: Number(d.fleetPower ?? 0),
        costAlloys: Number(d.costAlloys ?? 0),
        hullId,
      };
    }).filter((d) => d.id);
  }
  return [];
}

function availableParts(world: World, empireId: number, completed: string[]): AvailableParts {
  const fromSim = simApi.getAvailableShipParts?.(world, empireId);
  if (fromSim && Array.isArray(fromSim.hulls)) return fromSim;
  return {
    hulls: HULLS.filter((h) => techOk(h.requiredTech, completed)),
    weapons: WEAPONS.filter((w) => techOk(w.tech, completed)),
    modules: MODULES.filter((m) => techOk(m.tech, completed)),
  };
}

function techOk(required: string | null | undefined, completed: string[]): boolean {
  return !required || completed.includes(required);
}

function pickWeapons(hull: HullDef, completed: string[]): { slot: "small" | "medium" | "large"; list: WeaponDef[] }[] {
  return (["small", "medium", "large"] as const)
    .filter((slot) => hull.slots[slot] > 0)
    .map((slot) => ({ slot, list: WEAPONS.filter((w) => w.slot === slot && techOk(w.tech, completed)) }));
}

function moduleList(slot: "utility" | "internal", completed: string[]): ModuleDef[] {
  return MODULES.filter((m) => m.slot === slot && techOk(m.tech, completed));
}

function isReactor(m: ModuleDef): boolean {
  return m.id.startsWith("reactor") || (m.power > 0 && m.slot === "internal" && !m.cargo && !m.shieldAdd && !m.armorAdd);
}

/** Клиентский предпросмотр (fallback, если sim-валидатор ещё не подключён). */
function preview(hull: HullDef, weapons: WeaponDef[], modules: ModuleDef[]): DesignStats {
  const mass = hull.mass + modules.reduce((a, m) => a + m.mass, 0);
  const powerMax = modules.filter(isReactor).reduce((a, m) => a + Math.max(0, m.power), 0);
  const powerUse = weapons.reduce((a, w) => a + w.power, 0)
    + modules.filter((m) => !isReactor(m)).reduce((a, m) => a + Math.max(0, m.power), 0);
  const heat = weapons.reduce((a, w) => a + w.heat, 0);
  const dps = weapons.reduce((a, w) => a + w.dmg * w.rof * w.accuracy, 0);
  const shield = hull.shieldBase + modules.reduce((a, m) => a + (m.shieldAdd ?? 0), 0);
  const armor = hull.armorBase + modules.reduce((a, m) => a + (m.armorAdd ?? 0), 0);
  const costAlloys = hull.costAlloys + weapons.reduce((a, w) => a + w.costAlloys, 0)
    + modules.reduce((a, m) => a + m.costAlloys, 0);
  return {
    mass,
    maxMass: hull.maxMass,
    powerUse,
    powerMax,
    heat,
    fleetPower: Math.max(1, rnd(dps * 8 + (shield + armor + hull.hullHp) / 40)),
    costAlloys,
    costCredits: 0,
    buildTicks: hull.buildTicks + Math.ceil((weapons.length + modules.length) / 3),
  };
}

function fallbackErrors(hull: HullDef, weapons: WeaponDef[], modules: ModuleDef[], completed: string[], stats: DesignStats): { code: string; messageRu: string }[] {
  const errors: { code: string; messageRu: string }[] = [];
  if (weapons.length === 0) errors.push({ code: "no_weapons", messageRu: "Установите хотя бы одно оружие." });
  if (modules.filter(isReactor).length === 0) errors.push({ code: "no_reactor", messageRu: "Нужен реактор (внутренний слот)." });
  if (modules.filter((m) => m.id.startsWith("thruster")).length === 0) errors.push({ code: "no_thruster", messageRu: "Нужен двигатель (thruster)." });
  const internalCounts = new Map<string, number>();
  for (const m of modules.filter((x) => x.slot === "internal")) internalCounts.set(m.id, (internalCounts.get(m.id) ?? 0) + 1);
  for (const [id, n] of internalCounts) if (n > 2) errors.push({ code: "dup", messageRu: "Слишком много одинаковых модулей: " + id });
  if (stats.mass > hull.maxMass) {
    errors.push({ code: "mass", messageRu: "Масса " + intText(stats.mass) + " превышает лимит корпуса " + intText(hull.maxMass) + "." });
  }
  if (stats.powerUse > stats.powerMax) {
    errors.push({ code: "power", messageRu: "Не хватает энергии: расход " + intText(stats.powerUse) + ", реактор даёт " + intText(stats.powerMax) + "." });
  }
  for (const req of [hull.requiredTech, ...weapons.map((w) => w.tech), ...modules.map((m) => m.tech)]) {
    if (req && !techOk(req, completed)) errors.push({ code: "tech", messageRu: "Не изучена технология: " + tr("tech." + req, undefined, req) + "." });
  }
  return errors;
}

const NAME_SEQ = ["Клинок", "Страж", "Вихрь", "Копьё", "Заря", "Сокол"];

export function ShipDesignerPanel({ game, state, onClose }: FullPanelProps) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const completed = emp?.techs.completed ?? [];
  const parts = useMemo(() => (world && emp ? availableParts(world, emp.id, completed) : { hulls: HULLS, weapons: WEAPONS, modules: MODULES }), [world, emp?.id, completed.join(",")]);
  const buildableHulls = useMemo(() => parts.hulls.filter((h) => h.classId !== "flagship"), [parts.hulls]);
  const firstHull = buildableHulls.find((h) => techOk(h.requiredTech, completed)) ?? buildableHulls[0];
  const [hullId, setHullId] = useState<string>(firstHull?.id ?? "");
  const hull = parts.hulls.find((h) => h.id === hullId) ?? HULLS.find((h) => h.id === hullId) ?? firstHull;
  const initialPrefill = (): Record<string, string> => {
    if (!firstHull) return {};
    const internals = MODULES.filter((m) => m.slot === "internal" && techOk(m.tech, completed));
    const reactor = internals.find(isReactor);
    const thruster = internals.find((m) => m.id.startsWith("thruster"));
    const prefill: Record<string, string> = {};
    if (reactor && firstHull.slots.internal > 0) prefill["internal-0"] = reactor.id;
    if (thruster && firstHull.slots.internal > 1) prefill["internal-1"] = thruster.id;
    return prefill;
  };
  const [weaponSel, setWeaponSel] = useState<Record<string, string>>({});
  const [moduleSel, setModuleSel] = useState<Record<string, string>>(initialPrefill);
  const [name, setName] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // При смене корпуса сбрасываем слоты и ставим реактор по умолчанию.
  const changeHull = (id: string) => {
    setHullId(id);
    setWeaponSel({});
    const nextHull = HULLS.find((h) => h.id === id);
    const internals = nextHull ? MODULES.filter((m) => m.slot === "internal" && techOk(m.tech, completed)) : [];
    const reactor = internals.find(isReactor);
    const thruster = internals.find((m) => m.id.startsWith("thruster"));
    const prefill: Record<string, string> = {};
    if (reactor && (nextHull?.slots.internal ?? 0) > 0) prefill["internal-0"] = reactor.id;
    if (thruster && (nextHull?.slots.internal ?? 0) > 1) prefill["internal-1"] = thruster.id;
    setModuleSel(prefill);
    setSavedMsg(null);
  };

  const stationId = state.activeStationId;
  const systemId = state.activeSystemId
    ?? (stationId != null && world ? world.systems.find((s) => s.station?.id === stationId)?.id ?? null : null);

  if (!world || !emp || !hull) {
    return <Panel title={L("Конструктор кораблей", "Ship designer")} testId="constructor-panel"><div className="sf-empty">{L("Нет мира.", "No world.")}</div></Panel>;
  }

  const slotAccepts: Record<"small" | "medium" | "large", ("small" | "medium" | "large")[]> = {
    small: ["small"],
    medium: ["medium", "small"],
    large: ["large", "medium", "small"],
  };
  const weaponSlots = (["small", "medium", "large"] as const)
    .filter((slot) => hull.slots[slot] > 0)
    .map((slot) => ({ slot, list: parts.weapons.filter((w) => slotAccepts[slot].includes(w.slot)) }));
  const utilityModules = parts.modules.filter((m) => m.slot === "utility");
  const internalModules = parts.modules.filter((m) => m.slot === "internal");
  const weapons: WeaponDef[] = [];
  const modules: ModuleDef[] = [];
  for (const group of weaponSlots) {
    for (let i = 0; i < hull.slots[group.slot]; i++) {
      const id = weaponSel[group.slot + "-" + i];
      const w = WEAPONS.find((x) => x.id === id);
      if (w) weapons.push(w);
    }
  }
  for (let i = 0; i < hull.slots.utility; i++) {
    const m = MODULES.find((x) => x.id === moduleSel["utility-" + i]);
    if (m) modules.push(m);
  }
  for (let i = 0; i < hull.slots.internal; i++) {
    const m = MODULES.find((x) => x.id === moduleSel["internal-" + i]);
    if (m) modules.push(m);
  }

  const local = preview(hull, weapons, modules);
  const draftInput: DesignInput = { nameRu: name || "Дизайн", hullId: hull.id, weapons: weapons.map((w) => w.id), modules: modules.map((m) => m.id) };
  // Основной путь: validateShipDesign(world, empireId, draft). Fallback-формат getDesignPreview
  // (errorsRu/warningsRu/powerDraw/powerOutput/heatNet) нормализуем к той же форме.
  const simValidate = simApi.validateShipDesign?.(world, emp.id, draftInput);
  const simAlt = !simValidate ? simApi.getDesignPreview?.(world, emp.id, draftInput) : undefined;
  const simPreview: DesignValidation | undefined = simValidate ?? (simAlt ? {
    ok: simAlt.ok,
    errors: simAlt.errorsRu.map((messageRu, i) => ({ code: "preview" + i, messageRu })),
    warnings: simAlt.warningsRu.map((messageRu, i) => ({ code: "warn" + i, messageRu })),
    stats: {
      mass: simAlt.stats.mass, maxMass: hull.maxMass,
      powerUse: simAlt.stats.powerDraw, powerMax: simAlt.stats.powerOutput,
      heat: simAlt.stats.heatNet, fleetPower: simAlt.stats.fleetPower,
      costAlloys: simAlt.stats.costAlloys, costCredits: simAlt.stats.costCredits,
      buildTicks: simAlt.stats.buildTicks,
    },
  } : undefined);
  const stats: DesignStats = simPreview ? simPreview.stats : local;
  const warnings = (simPreview?.warnings ?? []).map((w) => w.messageRu);
  const errors = simPreview ? simPreview.errors : fallbackErrors(hull, weapons, modules, completed, local);
  const canSave = errors.length === 0 && !!systemId;
  const saved = savedDesigns(world, emp.id);
  const defaultName = NAME_SEQ[(saved.length) % NAME_SEQ.length] ?? "Дизайн";
  const designName = (name.trim() || defaultName) + " " + (hull.ru.split("«")[1]?.split("»")[0] ?? hull.id);

  const save = () => {
    const designBody = { nameRu: designName, hullId: hull.id, weapons: weapons.map((w) => w.id), modules: modules.map((m) => m.id) };
    const candidates: Record<string, unknown>[] = [
      { type: "save_design", design: designBody },
      { type: "create_design", ...designBody },
    ];
    let ok = false;
    for (const c of candidates) {
      if (send(game, c as unknown as Command)) { ok = true; break; }
    }
    setSavedMsg(ok ? L("Дизайн сохранён: ", "Design saved: ") + designName : L("Конструктор ещё не подключён в симуляции.", "Designer is not wired into simulation yet."));
    if (ok) game.toast(L("Дизайн сохранён: ", "Design saved: ") + designName, "good");
  };

  const build = (designId: string) => {
    if (systemId == null) { game.toast(L("Нужна станция с верфью.", "A shipyard station is required."), "warn"); return; }
    if (!send(game, { type: "build_ship", systemId, designId, count: 1 })) {
      game.toast(L("Не удалось заложить корабль.", "Failed to lay down the ship."), "bad");
    }
  };

  return (
    <div className="sf-designer" data-testid="constructor-panel">
      <div className="sf-designer__grid">
        <Panel title={L("Конфигурация корабля", "Ship configuration")} tall>
          <fieldset className="sf-designer__fieldset">
            <legend>{L("Корпус", "Hull")}</legend>
            <Field label={L("Корпус", "Hull")}>
              <select className="sf-select" value={hull.id} onChange={(e) => changeHull(e.target.value)} data-testid="select-hull" aria-label={L("Корпус", "Hull")}>
                {buildableHulls.map((h) => (
                  <option key={h.id} value={h.id} disabled={!techOk(h.requiredTech, completed)}>
                    {h.ru} — {h.classId} · масса {h.maxMass} · {h.costAlloys} спл.{!techOk(h.requiredTech, completed) ? " (нужна технология)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={L("Название дизайна", "Design name")}>
              <input className="sf-input" value={name} placeholder={defaultName} onChange={(e) => setName(e.target.value.slice(0, 32))} data-testid="input-design-name" aria-label={L("Название дизайна", "Design name")} />
            </Field>
            <div className="sf-meta">{hull.ru} · {hull.classId} · прочность {intText(hull.hullHp)} · щит {intText(hull.shieldBase)} · броня {intText(hull.armorBase)}</div>
          </fieldset>

          {weaponSlots.map((group) => (
            <fieldset className="sf-designer__fieldset" key={group.slot}>
              <legend>{L("Оружие", "Weapons")} · {group.slot}</legend>
              {group.list.length === 0 && (
                <div className="sf-warn">{L("Нет доступного оружия этого размера: изучите технологии.", "No weapons of this size are available: research technologies.")}</div>
              )}
              {Array.from({ length: hull.slots[group.slot] }).map((_, i) => (
                <Field key={i} label={"Слот " + (i + 1)}>
                  <select
                    className="sf-select"
                    value={weaponSel[group.slot + "-" + i] ?? ""}
                    onChange={(e) => setWeaponSel((p) => ({ ...p, [group.slot + "-" + i]: e.target.value }))}
                    data-testid={"weapon-slot-" + group.slot + "-" + i}
                    aria-label={L("Оружие", "Weapon") + " " + group.slot + " " + (i + 1)}
                  >
                    <option value="">{L("— пусто —", "— empty —")}</option>
                    {group.list.map((w) => (
                      <option key={w.id} value={w.id}>{w.ru} · {w.dmg}×{w.rof} · {w.heat} тепла · {w.costAlloys} спл.</option>
                    ))}
                  </select>
                </Field>
              ))}
            </fieldset>
          ))}

          <fieldset className="sf-designer__fieldset">
            <legend>{L("Модули · utility", "Modules · utility")}</legend>
            {Array.from({ length: hull.slots.utility }).map((_, i) => (
              <Field key={i} label={"Слот " + (i + 1)}>
                <select className="sf-select" value={moduleSel["utility-" + i] ?? ""}
                  onChange={(e) => setModuleSel((p) => ({ ...p, ["utility-" + i]: e.target.value }))}
                  data-testid={"module-slot-utility-" + i} aria-label={L("Модуль utility", "Utility module") + " " + (i + 1)}>
                  <option value="">{L("— пусто —", "— empty —")}</option>
                  {utilityModules.map((m) => <option key={m.id} value={m.id}>{m.ru} · масса {m.mass} · {m.power} эн.</option>)}
                </select>
              </Field>
            ))}
          </fieldset>

          <fieldset className="sf-designer__fieldset">
            <legend>{L("Модули · internal", "Modules · internal")}</legend>
            {Array.from({ length: hull.slots.internal }).map((_, i) => (
              <Field key={i} label={"Слот " + (i + 1)}>
                <select className="sf-select" value={moduleSel["internal-" + i] ?? ""}
                  onChange={(e) => setModuleSel((p) => ({ ...p, ["internal-" + i]: e.target.value }))}
                  data-testid={"module-slot-internal-" + i} aria-label={L("Модуль internal", "Internal module") + " " + (i + 1)}>
                  <option value="">{L("— пусто —", "— empty —")}</option>
                  {internalModules.map((m) => <option key={m.id} value={m.id}>{m.ru} · масса {m.mass} · {m.power > 0 ? "+" + m.power + " эн." : "0 эн."}</option>)}
                </select>
              </Field>
            ))}
          </fieldset>
        </Panel>

        <div className="sf-designer__side">
          <Panel title={L("Предпросмотр", "Preview")} testId="design-preview">
            <div aria-live="polite">
              <div className="sf-row"><b className="sf-nowrap">{designName}</b><span className="sf-spacer" /><Badge tone="info">{hull.classId}</Badge></div>
              <Sep />
              <div className="sf-grid2">
                <KV k={L("Масса", "Mass")} v={intText(stats.mass) + " / " + intText(stats.maxMass)} className={stats.mass > stats.maxMass ? "sf-bad" : ""} />
                <KV k={L("Энергия", "Power")} v={intText(stats.powerUse) + " / " + intText(stats.powerMax)} className={stats.powerUse > stats.powerMax ? "sf-bad" : ""} />
                <KV k={L("Тепло", "Heat")} v={intText(stats.heat)} />
                <KV k={L("Флитпауэр", "Fleet power")} v={intText(stats.fleetPower) + " FP"} />
                <KV k={L("Сплавы", "Alloys")} v={intText(stats.costAlloys)} />
                <KV k={L("Кредиты", "Credits")} v={stats.costCredits > 0 ? intText(stats.costCredits) : "—"} />
                <KV k={L("Время", "Build time")} v={intText(stats.buildTicks) + " " + L("такт.", "ticks")} />
                <KV k={L("Орудий", "Weapons")} v={intText(weapons.length)} />
              </div>
              <Sep />
              <div className="sf-h">{L("Требования", "Requirements")}</div>
              <div className="sf-list">
                {[hull.requiredTech, ...weapons.map((w) => w.tech), ...modules.map((m) => m.tech)]
                  .filter((x): x is string => !!x)
                  .filter((v, i, arr) => arr.indexOf(v) === i)
                  .map((req) => (
                    <div key={req} className="sf-line">
                      <span className={techOk(req, completed) ? "sf-ok" : "sf-bad"}>{techOk(req, completed) ? "✓" : "×"}</span>
                      <span className="sf-nowrap">{tr("tech." + req, undefined, req)}</span>
                      <span className="sf-spacer" />
                      <span className="sf-meta">{techOk(req, completed) ? L("изучено", "researched") : L("не изучено", "not researched")}</span>
                    </div>
                  ))}
                {[hull.requiredTech, ...weapons.map((w) => w.tech), ...modules.map((m) => m.tech)].filter(Boolean).length === 0 && (
                  <div className="sf-meta">{L("Технологических требований нет.", "No technology requirements.")}</div>
                )}
              </div>
            </div>
          </Panel>

          <Panel title={L("Проверка и постройка", "Validation and build")}>
            {errors.length > 0 ? (
              <div className="sf-designer__errors" role="alert" data-testid="design-errors" aria-live="assertive">
                <b>{L("Ошибки конфигурации:", "Configuration errors:")}</b>
                {errors.map((e, i) => <div key={e.code + i} className="sf-bad">• {e.messageRu}</div>)}
              </div>
            ) : (
              <div className="sf-ok" data-testid="design-valid">{L("Конфигурация валидна.", "Configuration is valid.")}</div>
            )}
            {warnings.length > 0 && (
              <div className="sf-warn" data-testid="design-warnings">
                {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}
            <div className="sf-row" style={{ marginTop: 6, flexWrap: "wrap", gap: 4 }}>
              <Btn variant="primary" disabled={!canSave} onClick={save} testId="btn-save-design" title={!systemId ? L("Нужна станция", "Station required") : undefined}>
                {L("Сохранить дизайн", "Save design")}
              </Btn>
              {savedMsg && <span className="sf-meta" role="status">{savedMsg}</span>}
            </div>
            <div className="sf-meta">
              {L("Постройка доступна только на станции с верфью; готовый корабль встаёт в очередь верфи.", "Building requires a shipyard station; the finished ship joins the shipyard queue.")}
            </div>
          </Panel>

          <Panel title={L("Сохранённые дизайны", "Saved designs")} right={<Badge>{saved.length}</Badge>}>
            {saved.length === 0 && <div className="sf-meta">{L("Пользовательских дизайнов нет.", "No custom designs yet.")}</div>}
            {saved.map((d) => (
              <div key={d.id} className="sf-line" data-testid={"design-row-" + d.id}>
                <span className="sf-nowrap">{d.label}</span>
                <span className="sf-meta">{d.classId} · {intText(d.fleetPower)} FP · {costText({ alloys: d.costAlloys })}</span>
                <span className="sf-spacer" />
                <Btn size="sm" variant="primary" onClick={() => build(d.id)} testId={"btn-build-design-" + d.id}>{L("Построить", "Build")}</Btn>
              </div>
            ))}
            <Sep />
            <Btn size="sm" variant="ghost" onClick={onClose}>{L("Назад к станции", "Back to station")}</Btn>
          </Panel>
        </div>
      </div>
    </div>
  );
}
