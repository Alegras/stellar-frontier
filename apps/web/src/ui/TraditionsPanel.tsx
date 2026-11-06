import { useEffect, useMemo, useRef, useState } from "react";
import { traditionNodeCost } from "@sf/sim";
import type { PerkDef } from "@sf/data";
import { Badge, Btn, Panel, Sep, Tip } from "./controls";
import { L, advOf, effectText, PERK_LIST, send, TRADITION_TREE_LIST, tr, useLocale, type FullPanelProps } from "./fg";
import { intText, num, playerEmpire, worldOf } from "./util";

/** 7 древ × 5 узлов + финишер; RPG-дерево с зумом/паном; перки вознесения — отдельной панелью. */
type Tree = (typeof TRADITION_TREE_LIST)[number];
type Node = Tree["nodes"][number];
type Finisher = NonNullable<Tree["finisher"]> & { requires?: string[] };

const CANVAS = 2800;
const CENTER = CANVAS / 2;
const NODE_W = 196;
const NODE_H = 98;
const ROOT_W = 250;
const ROOT_H = 124;
const FIN_W = 210;
const FIN_H = 104;

interface XY { x: number; y: number }
interface NodeLayout { node: Node; tree: Tree; pos: XY; index: number }
interface FinLayout { fin: Finisher; tree: Tree; pos: XY }

function angleFor(treeIndex: number): number { return -Math.PI / 2 + (treeIndex * Math.PI * 2) / 7; }
function nodePos(treeIndex: number, index: number): XY {
  const a = angleFor(treeIndex);
  const r = 430 + index * 170;
  return { x: CENTER + Math.cos(a) * r, y: CENTER + Math.sin(a) * r };
}
function finPos(treeIndex: number): XY {
  const a = angleFor(treeIndex);
  return { x: CENTER + Math.cos(a) * 1270, y: CENTER + Math.sin(a) * 1270 };
}

export function TraditionsPanel({ game }: FullPanelProps) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const adv = advOf(world, emp?.id ?? 0);
  useLocale();
  const [treeId, setTreeId] = useState<string>(TRADITION_TREE_LIST[0]?.id ?? "");

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
    <div className="sf-trad-grid" data-testid="traditions-panel">
      <Panel title={tr("traditions.title", undefined, "Традиции") + " · 7"} tall testId="traditions-stats"
        right={<Badge tone="info">{intText(unlocked.size)} / {trees.reduce((a, t) => a + t.nodes.length + 1, 0) || "—"}</Badge>}>
        <div className="sf-kv"><span className="sf-dim">{tr("traditions.unity", undefined, "Единство в казне")}</span><b className="sf-gold">{intText(unity)}</b></div>
        <div className="sf-kv"><span className="sf-dim">{L("Потрачено на традиции", "Spent on traditions")}</span><b>{intText(spent)}</b></div>
        <div className="sf-kv"><span className="sf-dim">{L("Узлов открыто", "Nodes unlocked")}</span><b>{intText(unlocked.size)}</b></div>
        <Sep />
        <div className="sf-meta">{L("7 ветвей. Клик по карточке открывает узел; колесо — зум, мышь — панорама.", "7 branches. Click a card to unlock; wheel zooms, drag pans.")}</div>
        <div className="sf-fg-trees">
          {trees.map((t) => {
            const own = t.nodes.filter((n) => unlocked.has(n.id)).length;
            return (
              <button key={t.id} type="button"
                className={"sf-fg-treebtn" + (tree?.id === t.id ? " sf-fg-treebtn--on" : "")}
                onClick={() => setTreeId(t.id)}
                data-testid={"tradition-tree-" + t.id}
                style={{ borderLeftColor: t.color }}>
                <span className="sf-nowrap">{t.ru}</span>
                <span className="sf-meta">{own}/{t.nodes.length}{finishers.has(t.finisher?.id) ? " ★" : ""}</span>
              </button>
            );
          })}
        </div>
        <div className="sf-meta" style={{ marginTop: 6 }}>{L("Всего открыто узлов и перков:", "Nodes and perks unlocked:")} {intText(canChaos)}</div>
      </Panel>

      <Panel className="sf-trad-tree" title={tree ? L("Древо", "Tree") + " · " + tree.ru : L("Древо традиций", "Tradition tree")} tall
        right={tree && <Badge tone="info">{tree.nodes.filter((n) => unlocked.has(n.id)).length}/{tree.nodes.length}{finishers.has(tree.finisher?.id) ? " ★" : ""}</Badge>}>
        {trees.length === 0 ? (
          <div className="sf-empty">{L("Контент традиций ещё не загружен.", "Tradition content is not loaded.")}</div>
        ) : (
          <TraditionTree
            game={game}
            trees={trees}
            treeId={tree?.id ?? ""}
            onSelectTree={setTreeId}
            unlocked={unlocked}
            finishers={finishers}
            unity={unity}
          />
        )}
      </Panel>

      <Panel className="sf-trad-perks" title={tr("perks.title", undefined, "Перки вознесения")}
        right={<Badge tone={slotsUsed >= slotsMax ? "warn" : "good"}>{slotsUsed}/{slotsMax}</Badge>} tall>
        <PerksView game={game} perks={perks} perkOwned={perkOwned} slotsUsed={slotsUsed} slotsMax={slotsMax} unity={unity} />
      </Panel>
    </div>
  );
}

function TraditionTree({
  game, trees, treeId, onSelectTree, unlocked, finishers, unity,
}: {
  game: FullPanelProps["game"];
  trees: Tree[];
  treeId: string;
  onSelectTree: (id: string) => void;
  unlocked: Set<string>;
  finishers: Set<string>;
  unity: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ x: -CANVAS / 2, y: -CANVAS / 2, scale: 0.55 });
  const drag = useRef<{ px: number; py: number; vx: number; vy: number; moved: boolean } | null>(null);
  const selectedTree = trees.find((t) => t.id === treeId) ?? trees[0];

  const layouts = useMemo(() => {
    const nodes: NodeLayout[] = [];
    const fins: FinLayout[] = [];
    trees.forEach((tree, ti) => {
      tree.nodes.forEach((node, i) => nodes.push({ node, tree, pos: nodePos(ti, i), index: i }));
      if (tree.finisher) fins.push({ fin: tree.finisher, tree, pos: finPos(ti) });
    });
    return { nodes, fins };
  }, [trees]);

  const fit = () => {
    const host = hostRef.current;
    if (!host) return;
    const w = host.clientWidth || 800, h = host.clientHeight || 480;
    const scale = Math.min(w / (CANVAS + 180), h / (CANVAS + 180));
    setView({ scale, x: (w - CANVAS * scale) / 2, y: (h - CANVAS * scale) / 2 });
  };

  useEffect(() => {
    // стартовый вид: корень + карточки ближних узлов (читаемый RPG-масштаб), «Вся карта» — отдельной кнопкой
    const host = hostRef.current;
    const w = host?.clientWidth || 800, h = host?.clientHeight || 480;
    const scale = 0.62;
    setView({ scale, x: (w - CANVAS * scale) / 2, y: (h - CANVAS * scale) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const px = cx ?? rect.width / 2, py = cy ?? rect.height / 2;
    setView((v) => {
      const scale = Math.max(0.2, Math.min(1.6, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px, dy = e.clientY - d.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = () => { const d = drag.current; if (d) window.setTimeout(() => { drag.current = null; }, 0); };

  const nodeState = (node: Node, tree: Tree): { cls: string; reason: string; cost: number } => {
    const isUnlocked = unlocked.has(node.id);
    const reqOk = node.requires.every((r) => unlocked.has(r));
    const cost = node.cost > 0 ? node.cost : traditionNodeCost(node.index ?? 0);
    const afford = unity >= cost;
    if (isUnlocked) return { cls: "sf-tradnode--unlocked", reason: L("Уже открыто", "Already unlocked"), cost };
    if (!reqOk) return { cls: "sf-tradnode--locked", reason: L("Сначала предыдущие узлы", "Unlock previous nodes first"), cost };
    if (!afford) return { cls: "sf-tradnode--poor", reason: L("Не хватает единства", "Not enough unity"), cost };
    return { cls: "sf-tradnode--ready", reason: L("Можно открыть.", "Can be unlocked."), cost };
  };
  const canUnlock = (node: Node): boolean => {
    if (unlocked.has(node.id)) return false;
    if (!node.requires.every((r) => unlocked.has(r))) return false;
    const cost = node.cost > 0 ? node.cost : traditionNodeCost(node.index ?? 0);
    return unity >= cost;
  };
  const canFinisher = (fin: Finisher): boolean => {
    if (finishers.has(fin.id)) return false;
    const reqs = fin.requires ?? [];
    const tree = trees.find((t) => t.finisher?.id === fin.id);
    const reqOk = reqs.length > 0 ? reqs.every((r) => unlocked.has(r)) : !!tree && tree.nodes.every((n) => unlocked.has(n.id));
    return reqOk;
  };

  const nodeById = new Map<string, NodeLayout>();
  for (const l of layouts.nodes) nodeById.set(l.node.id, l);
  const lines: { x1: number; y1: number; x2: number; y2: number; color: string; dim: boolean; on: boolean }[] = [];
  for (const l of layouts.nodes) {
    const color = l.tree.color;
    const dim = l.tree.id !== treeId;
    if (l.index === 0) lines.push({ x1: CENTER, y1: CENTER, x2: l.pos.x, y2: l.pos.y, color, dim, on: unlocked.has(l.node.id) });
    for (const req of l.node.requires) {
      const from = nodeById.get(req);
      if (from) lines.push({ x1: from.pos.x, y1: from.pos.y, x2: l.pos.x, y2: l.pos.y, color, dim, on: unlocked.has(l.node.id) && unlocked.has(req) });
    }
  }
  for (const f of layouts.fins) {
    const color = f.tree.color, dim = f.tree.id !== treeId;
    const reqs = (f.fin.requires ?? f.tree.nodes.map((n: Node) => n.id)) as string[];
    const froms = reqs.map((r) => nodeById.get(r)).filter((x): x is NodeLayout => !!x);
    const sources = froms.length ? froms : f.tree.nodes.length ? [nodeById.get(f.tree.nodes[f.tree.nodes.length - 1]!.id)].filter((x): x is NodeLayout => !!x) : [];
    for (const from of sources) lines.push({ x1: from.pos.x, y1: from.pos.y, x2: f.pos.x, y2: f.pos.y, color, dim, on: finishers.has(f.fin.id) });
  }

  return (
    <div className="sf-tradtree" data-testid="tradition-tree-canvas">
      <div className="sf-tradtree__toolbar">
        <button type="button" className="sf-tradtree__tool" data-testid="tradtree-zoom-out" onClick={() => zoomAt(1 / 1.2)}>−</button>
        <span className="sf-tradtree__zoom" data-testid="tradtree-zoom">{Math.round(view.scale * 100)}%</span>
        <button type="button" className="sf-tradtree__tool" data-testid="tradtree-zoom-in" onClick={() => zoomAt(1.2)}>+</button>
        <button type="button" className="sf-tradtree__tool" data-testid="tradtree-fit" onClick={fit}>{L("Вся карта", "Fit")}</button>
        <span className="sf-spacer" />
        <span className="sf-meta">{L("колесо — зум · мышь — панорама", "wheel zoom · drag pan")}</span>
      </div>
      <div
        ref={hostRef}
        className="sf-tradtree__viewport"
        data-testid="tradition-tree-viewport"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={fit}
      >
        <div className="sf-tradtree__canvas" style={{ width: CANVAS, height: CANVAS, transform: "translate(" + view.x + "px," + view.y + "px) scale(" + view.scale + ")" }}>
          <svg className="sf-tradtree__lines" width={CANVAS} height={CANVAS} aria-hidden="true">
            {lines.map((l, i) => (
              <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                stroke={l.color} strokeWidth={l.on ? 3 : 2} opacity={l.dim ? 0.12 : l.on ? 0.9 : 0.35}
                strokeDasharray={l.on ? undefined : "6 5"} />
            ))}
          </svg>
          <div className="sf-tradroot" style={{ left: CENTER, top: CENTER, width: ROOT_W, height: ROOT_H }}>
            <b>{tr("traditions.title", undefined, "Традиции")}</b>
            <div className="sf-meta">{L("Корень · 7 ветвей", "Root · 7 branches")}</div>
            <div className="sf-meta">{intText(unlocked.size)} / {trees.reduce((a, t) => a + t.nodes.length + 1, 0)}</div>
          </div>
          {trees.map((t, ti) => (
            <button key={t.id} type="button"
              className={"sf-tradbranch" + (t.id === treeId ? " sf-tradbranch--on" : "")}
              style={{ left: CENTER + Math.cos(angleFor(ti)) * 230, top: CENTER + Math.sin(angleFor(ti)) * 230, borderColor: t.color, color: t.color }}
              data-testid={"trad-branch-" + t.id}
              onClick={(e) => { e.stopPropagation(); onSelectTree(t.id); }}>
              {t.ru}
            </button>
          ))}
          {layouts.nodes.map((l) => {
            const st = nodeState(l.node, l.tree);
            const selected = l.tree.id === treeId;
            return (
              <button key={l.node.id} type="button"
                className={"sf-tradnode " + st.cls + (selected ? " sf-tradnode--selected" : "")}
                style={{ left: l.pos.x, top: l.pos.y, width: NODE_W, height: NODE_H, borderColor: l.tree.color }}
                data-testid={"btn-tradition-" + l.node.id}
                title={st.reason + " · " + tr("traditions.cost", { cost: intText(st.cost) }, "единства")}
                onClick={(e) => {
                  e.stopPropagation();
                  if (drag.current?.moved) return;
                  onSelectTree(l.tree.id);
                  if (canUnlock(l.node)) send(game, { type: "tradition_unlock", treeId: l.tree.id, nodeId: l.node.id });
                }}>
                <span className="sf-tradnode__title">{l.index + 1}. {l.node.ru}</span>
                <span className="sf-tradnode__desc">{l.node.descRu}</span>
                <span className="sf-tradnode__fx">{Object.entries(l.node.effects ?? {}).map(([k, v]) => effectText(k, v)).join(" · ") || L("эффект из данных", "effect from data")}</span>
                <span className="sf-tradnode__foot">
                  <span>{st.cls === "sf-tradnode--unlocked" ? "✓ " + tr("traditions.completed", undefined, "Открыто") : intText(st.cost) + " " + L("ед.", "u.")}</span>
                  <span>{st.cls === "sf-tradnode--ready" ? L("открыть", "unlock") : st.cls === "sf-tradnode--poor" ? L("мало единства", "not enough") : st.cls === "sf-tradnode--locked" ? L("закрыто", "locked") : ""}</span>
                </span>
              </button>
            );
          })}
          {layouts.fins.map((f) => {
            const active = finishers.has(f.fin.id);
            const ready = canFinisher(f.fin);
            const selected = f.tree.id === treeId;
            return (
              <button key={f.fin.id} type="button"
                className={"sf-tradnode sf-tradnode--finisher " + (active ? "sf-tradnode--unlocked" : ready ? "sf-tradnode--ready" : "sf-tradnode--locked") + (selected ? " sf-tradnode--selected" : "")}
                style={{ left: f.pos.x, top: f.pos.y, width: FIN_W, height: FIN_H, borderColor: f.tree.color }}
                data-testid={selected ? "btn-tradition-finisher" : "btn-tradition-finisher-" + f.tree.id}
                title={active ? L("Активен", "Active") : ready ? L("Можно активировать", "Can activate") : L("Нужны все 5 узлов", "All 5 nodes required")}
                onClick={(e) => {
                  e.stopPropagation();
                  if (drag.current?.moved) return;
                  onSelectTree(f.tree.id);
                  if (ready) send(game, { type: "tradition_unlock", treeId: f.tree.id, nodeId: f.fin.id });
                }}>
                <span className="sf-tradnode__title">★ {tr("traditions.finisher", undefined, "Финишер")} · {f.fin.ru}</span>
                <span className="sf-tradnode__desc">{f.fin.descRu}</span>
                <span className="sf-tradnode__fx">{Object.entries(f.fin.effects ?? {}).map(([k, v]) => effectText(k, v)).join(" · ")}</span>
                <span className="sf-tradnode__foot"><span>{f.tree.ru}</span><span>{active ? L("Активен", "Active") : ready ? L("Активировать", "Activate") : L("Закрыт", "Locked")}</span></span>
              </button>
            );
          })}
          {selectedTree && <span className="sf-sr-only">{selectedTree.ru}</span>}
        </div>
      </div>
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
  onToggle?: () => void;
}) {
  return (
    <div className="sf-list" data-testid="perks-grid">
      <div className="sf-meta">
        {tr("perks.slots", { used: slotsUsed, total: slotsMax }, "Слоты перков")}. {L("Перк открывается за единство.", "Unlocked with unity.")}
      </div>
      {onToggle && <Btn size="sm" variant="ghost" onClick={onToggle}>{L("← к узлам древа", "← back to nodes")}</Btn>}
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
