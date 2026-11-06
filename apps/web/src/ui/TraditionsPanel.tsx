import { useMemo, useState } from "react";
import { traditionNodeCost } from "@sf/sim";
import type { PerkDef } from "@sf/data";
import { Badge, Btn, Panel, Sep, Tip } from "./controls";
import { L, advOf, effectText, PERK_LIST, send, TRADITION_TREE_LIST, tr, useLocale, type FullPanelProps } from "./fg";
import { intText, num, playerEmpire, worldOf } from "./util";

/** 7 древ × 5 узлов + финишер, и перки вознесения (8 слотов). */
export function TraditionsPanel({ game }: FullPanelProps) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const adv = advOf(world, emp?.id ?? 0);
  useLocale();
  const [treeId, setTreeId] = useState<string>(TRADITION_TREE_LIST[0]?.id ?? "");
  const [perkTab, setPerkTab] = useState(false);

  const unity = emp?.resources.unity ?? 0;
  const trees = TRADITION_TREE_LIST;
  const perks = PERK_LIST;
  const unlocked = new Set(adv?.traditions.unlocked ?? []);
  const finishers = new Set(adv?.traditions.finishers ?? []);
  const perkOwned = new Set(adv?.perks ?? []);
  const slotsUsed = adv?.perks.length ?? 0;
  const slotsMax = adv?.perkSlots ?? 8;
  const tree = useMemo(() => trees.find((t) => t.id === treeId) ?? trees[0] ?? null, [trees, treeId]);

  if (!world || !emp || !adv) {
    return (
      <Panel title={tr("traditions.title", undefined, "Традиции и перки")} testId="traditions-panel">
        <div className="sf-empty">Мир ещё не создан.</div>
      </Panel>
    );
  }

  const canChaos = adv.traditions.unlocked.length + adv.perks.length;
  const spent = adv.traditions.unitySpent;

  return (
    <div className="sf-fg-grid" data-testid="traditions-panel">
      <Panel
        title={tr("traditions.title", undefined, "Традиции") + " · 7"}
        right={<Badge tone="info">{intText(unlocked.size)} / {trees.reduce((a, t) => a + t.nodes.length + 1, 0) || "—"}</Badge>}
        tall
      >
        <div className="sf-kv"><span className="sf-dim">{tr("traditions.unity", undefined, "Единство в казне")}</span><b className="sf-gold">{intText(unity)}</b></div>
        <div className="sf-kv"><span className="sf-dim">{L("Потрачено на традиции", "Spent on traditions")}</span><b>{intText(spent)}</b></div>
        <div className="sf-kv"><span className="sf-dim">{L("Узлов открыто", "Nodes unlocked")}</span><b>{intText(unlocked.size)}</b></div>
        <Sep />
        {trees.length === 0 && (
          <div className="sf-empty">
            {L("Контент традиций ещё не загружен в @sf/data (task-12).", "Tradition content is not loaded from @sf/data yet (task-12).")}
            <div className="sf-meta">{L("Панель автоматически заполнится; сейчас показаны только счётчики прогресса.", "The panel fills automatically; only progress counters are shown now.")}</div>
          </div>
        )}
        <div className="sf-fg-trees">
          {trees.map((t) => {
            const own = t.nodes.filter((n) => unlocked.has(n.id)).length;
            return (
              <button
                key={t.id}
                type="button"
                className={"sf-fg-treebtn" + (tree?.id === t.id ? " sf-fg-treebtn--on" : "")}
                onClick={() => setTreeId(t.id)}
                data-testid={"tradition-tree-" + t.id}
                style={{ borderLeftColor: t.color }}
              >
                <span className="sf-nowrap">{t.ru}</span>
                <span className="sf-meta">{own}/{t.nodes.length}{finishers.has(t.finisher?.id) ? " ★" : ""}</span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel
        title={(tree ? L("Древо", "Tree") + " · " + tree.ru : L("Древо", "Tree"))}
        right={tree && (
          <Btn size="sm" variant={perkTab ? "default" : "primary"} onClick={() => setPerkTab(false)} testId="btn-tradition-nodes">{L("Узлы", "Nodes")}</Btn>
        )}
        tall
      >
        {(perkTab || !tree) ? (
          <PerksView
            game={game}
            perks={perks}
            perkOwned={perkOwned}
            slotsUsed={slotsUsed}
            slotsMax={slotsMax}
            unity={unity}
            onToggle={() => setPerkTab(false)}
          />
        ) : (
          <>
            <div className="sf-row">
              <Btn size="sm" variant={perkTab ? "primary" : "default"} onClick={() => setPerkTab(true)} testId="btn-open-perks">{tr("perks.slots", { used: slotsUsed, total: slotsMax }, "Перки")}</Btn>
              <span className="sf-spacer" />
              {tree.descRu && <span className="sf-meta sf-nowrap">{tree.descRu}</span>}
            </div>
            <Sep />
            <div className="sf-list">
              {tree.nodes.map((node, idx) => {
                const isUnlocked = unlocked.has(node.id);
                const reqOk = node.requires.every((r) => unlocked.has(r));
                const cost = node.cost > 0 ? node.cost : traditionNodeCost(idx);
                const afford = unity >= cost;
                const reason = isUnlocked ? L("Уже открыто", "Already unlocked") : !reqOk ? L("Сначала предыдущие узлы", "Unlock previous nodes first") : !afford ? L("Не хватает единства", "Not enough unity") : "";
                return (
                  <div key={node.id} className="sf-line" style={{ alignItems: "flex-start" }}>
                    <span className={isUnlocked ? "sf-ok" : reqOk ? "sf-gold" : "sf-bad"}>{isUnlocked ? "✓" : reqOk ? "•" : "×"}</span>
                    <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                      <div className="sf-row">
                        <b className="sf-nowrap">{idx + 1}. {node.ru}</b>
                        <span className="sf-spacer" />
                        <span className="sf-meta">{tr("traditions.cost", { cost: intText(cost) }, "единства")}</span>
                      </div>
                      <div className="sf-meta">{node.descRu}</div>
                      <div className="sf-meta">
                        {Object.entries(node.effects ?? {}).map(([k, v]) => effectText(k, v)).join(" · ") || L("эффект из данных", "effect from data")}
                      </div>
                    </div>
                    <Tip data={{
                      title: node.ru,
                      value: tr("traditions.cost", { cost: intText(cost) }, "единства"),
                      lines: [
                        { label: L("Формула", "Formula"), value: L("400 × 1,5^индекс (из sim)", "400 × 1.5^index (from sim)") },
                        { label: L("Требует", "Requires"), value: node.requires.length ? node.requires.join(", ") : L("только предыдущий узел", "previous node only") },
                        ...Object.entries(node.effects ?? {}).map(([k, v]) => ({ label: k, value: String(v) })),
                      ],
                      consequence: reason || L("Можно открыть.", "Can be unlocked."),
                    }}>
                      <Btn
                        size="sm"
                        variant={!reason ? "primary" : "default"}
                        disabled={!!reason}
                        onClick={() => send(game, { type: "tradition_unlock", treeId: tree.id, nodeId: node.id })}
                        testId={"btn-tradition-" + node.id}
                      >
                        {isUnlocked ? tr("traditions.completed", undefined, "Открыто") : L("Открыть", "Unlock")}
                      </Btn>
                    </Tip>
                  </div>
                );
              })}
              {tree.finisher && (
                <>
                  <Sep />
                  <div className="sf-line" style={{ alignItems: "flex-start" }}>
                    <span className={finishers.has(tree.finisher.id) ? "sf-ok" : "sf-gold"}>★</span>
                    <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                      <b>{tr("traditions.finisher", undefined, "Финишер")} · {tree.finisher.ru}</b>
                      <div className="sf-meta">{tree.finisher.descRu}</div>
                      <div className="sf-meta">
                        {Object.entries(tree.finisher.effects ?? {}).map(([k, v]) => effectText(k, v)).join(" · ")}
                      </div>
                    </div>
                    <Tip data={{
                      title: tr("traditions.finisher", undefined, "Финишер древа"),
                      value: finishers.has(tree.finisher.id) ? "активен" : "нужны все 5 узлов",
                      lines: [{ label: L("Древо", "Tree"), value: tree.ru }],
                      consequence: finishers.has(tree.finisher.id) ? "Бонус уже действует." : "Откройте все узлы древа.",
                    }}>
                      <Btn size="sm" variant="primary" disabled={finishers.has(tree.finisher.id)} onClick={() => send(game, { type: "tradition_unlock", treeId: tree.id, nodeId: tree.finisher.id })} testId="btn-tradition-finisher">
                        {finishers.has(tree.finisher.id) ? L("Активен", "Active") : L("Активировать", "Activate")}
                      </Btn>
                    </Tip>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </Panel>

      <Panel title={tr("perks.title", undefined, "Перки вознесения")} right={<Badge tone={slotsUsed >= slotsMax ? "warn" : "good"}>{slotsUsed}/{slotsMax}</Badge>} tall>
        <PerksView
          game={game}
          perks={perks}
          perkOwned={perkOwned}
          slotsUsed={slotsUsed}
          slotsMax={slotsMax}
          unity={unity}
          onToggle={() => setPerkTab(true)}
        />
        <div className="sf-meta" style={{ marginTop: 6 }}>
          {L("Всего открыто узлов и перков:", "Nodes and perks unlocked:")} {intText(canChaos)} · {L("слоты перков дают крупные бонусы за единство.", "perk slots grant major unity bonuses.")}
        </div>
      </Panel>
    </div>
  );
}

function PerksView({
  game, perks, perkOwned, slotsUsed, slotsMax, unity, onToggle,
}: {
  game: FullPanelProps["game"];
  perks: PerkDef[];
  perkOwned: Set<string>;
  slotsUsed: number;
  slotsMax: number;
  unity: number;
  onToggle: () => void;
}) {
  return (
    <div className="sf-list" data-testid="perks-grid">
      <div className="sf-meta">
        {tr("perks.slots", { used: slotsUsed, total: slotsMax }, "Слоты перков")}. {L("Перк открывается за единство.", "Unlocked with unity.")}
      </div>
      <Btn size="sm" variant="ghost" onClick={onToggle}>{L("← к узлам древа", "← back to nodes")}</Btn>
      <Sep />
      {perks.length === 0 && (
        <div className="sf-empty">
          {L("Контент перков ещё не загружен в @sf/data (task-12).", "Perk content is not loaded from @sf/data yet (task-12).")}
          <div className="sf-meta">Сейчас открыто {intText(slotsUsed)} из {intText(slotsMax)} слотов.</div>
        </div>
      )}
      <div className="sf-perk-grid">
        {perks.map((p) => {
          const owned = perkOwned.has(p.id);
          const full = slotsUsed >= slotsMax;
          const reqOk = (p.requires ?? []).every((r) => perkOwned.has(r));
          const cost = num(p.cost);
          const reason = owned ? L("Уже открыт", "Already taken") : full ? L("Нет свободных слотов", "No free slots") : !reqOk ? L("Требуются предыдущие перки", "Previous perks required") : unity < cost ? L("Не хватает единства", "Not enough unity") : "";
          return (
            <Tip key={p.id} data={{
              title: p.ru,
              value: tr("traditions.cost", { cost: intText(cost) }, "единства"),
              lines: [
                ...Object.entries(p.effects ?? {}).map(([k, v]) => ({ label: k, value: String(v) })),
                ...(p.unlocks && p.unlocks.length ? [{ label: "Открывает", value: p.unlocks.join(", ") }] : []),
              ],
              note: p.descRu,
              consequence: reason || L("Можно открыть.", "Can be unlocked."),
            }}>
              <div className={"sf-perk-card" + (owned ? " sf-perk-card--owned" : "")}>
                <b className="sf-nowrap">{p.ru}</b>
                <div className="sf-meta">{intText(cost)} {L("ед.", "u.")}</div>
                <Btn size="sm" variant={owned ? "default" : "primary"} disabled={!!reason} onClick={() => send(game, { type: "perk_unlock", perkId: p.id })} testId={"btn-perk-" + p.id}>
                  {owned ? tr("perks.taken", undefined, "Открыт") : tr("perks.pick", undefined, "Взять")}
                </Btn>
              </div>
            </Tip>
          );
        })}
      </div>
      <div className="sf-meta">{L("Единство", "Unity")}: {intText(unity)} · {L("слотов свободно", "free slots")}: {intText(Math.max(0, slotsMax - slotsUsed))}</div>
    </div>
  );
}
