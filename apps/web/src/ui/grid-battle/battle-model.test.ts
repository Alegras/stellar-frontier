/**
 * Регрессионные тесты гексагональной боёвки v2 («Сетка командования»).
 * Ловят баги, из-за которых «Завершить ход» не запускал врага, авто-бой всегда
 * проигрывался, а юниты гибли с остатком HP.
 */
import { describe, expect, it } from "vitest";
import {
  apOf, canAttack, clone, createMockBattle, distance, formation, fpOf, hexCenter, lineHexes,
  neighbors, reachable, runAutoBattle, startV2, v2AiPhase, v2Attack, v2EndPhase, v2Move, type Battle,
} from "./model";

const ALL: Array<{ q: number; r: number }> = [];
for (let r = 0; r < 11; r++) for (let q = 0; q < 15; q++) ALL.push({ q, r });
const pixelDist = (a: { q: number; r: number }, b: { q: number; r: number }): number => {
  const c1 = hexCenter(a.q, a.r), c2 = hexCenter(b.q, b.r);
  return Math.hypot(c1.x - c2.x, c1.y - c2.y);
};
const freshBattle = (seed: number): Battle => {
  const b = createMockBattle({ seed });
  formation(b, "line", "player");
  startV2(b);
  return b;
};
/** Кликает «Завершить ход» как игрок: своя фаза — end phase, фаза врага — полный ход ИИ. */
const playIdlePhase = (b: Battle): void => {
  if (b.phase !== "battle") return;
  if (b.turnSide === "player") v2EndPhase(b); else v2AiPhase(b);
};

describe("гекс-геометрия (odd-r offset ↔ cube)", () => {
  it("distance = 1 тогда и только тогда, когда гекс в neighbors()", () => {
    let mismatches = 0;
    for (const a of ALL) for (const b of ALL) {
      const d = distance(a, b);
      const nb = neighbors(a.q, a.r).some((n) => n.q === b.q && n.r === b.r);
      if ((d === 1) !== nb) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it("сосед — это реально соседний гекс на нарисованном поле", () => {
    const liars = ALL.flatMap((a) => neighbors(a.q, a.r).filter((n) => pixelDist(a, n) > 40));
    expect(liars).toHaveLength(0);
  });

  it("расстояние симметрично и подчиняется неравенству треугольника", () => {
    const sample = ALL.filter((_, i) => i % 3 === 0); // детерминированная выборка, чтобы тест был быстрым
    for (const a of ALL) for (const b of ALL) expect(distance(a, b)).toBe(distance(b, a));
    for (const a of sample) for (const b of sample) for (const c of sample) {
      expect(distance(a, c)).toBeLessThanOrEqual(distance(a, b) + distance(b, c));
    }
  });

  it("линия LOS соединяет концы и состоит из соседних шагов", () => {
    const a = { q: 1, r: 2 }, b = { q: 9, r: 7 };
    const line = lineHexes(a, b);
    expect(line[0]).toEqual(a);
    expect(line[line.length - 1]).toEqual(b);
    expect(line).toHaveLength(distance(a, b) + 1);
    for (let i = 1; i < line.length; i++) expect(distance(line[i - 1]!, line[i]!)).toBe(1);
  });

  it("ближняя атака невозможна через не соседний гекс", () => {
    // раньше (2,1)→(1,2) — 55 px друг от друга — считалось «соседним»
    const b = freshBattle(7);
    const p = b.stacks.find((s) => s.side === "player")!;
    const e = b.stacks.find((s) => s.side === "enemy")!;
    p.q = 2; p.r = 1; e.q = 1; e.r = 2;
    expect(pixelDist(p, e)).toBeGreaterThan(40);
    expect(canAttack(b, p, e, false).ok).toBe(false);
  });
});

describe("урон, HP и count", () => {
  it("стек не может быть уничтожен с остатком HP", () => {
    const b = freshBattle(7);
    runAutoBattle(b);
    expect(b.stacks.filter((s) => !s.alive && s.hp > 0)).toHaveLength(0);
  });

  it("count всегда выводится из HP", () => {
    const b = freshBattle(7);
    for (let i = 0; i < 3 && b.phase === "battle"; i++) playIdlePhase(b);
    for (const s of b.stacks) {
      if (!s.alive) continue;
      const perShip = s.maxHp / Math.max(1, s.startCount);
      expect(s.count).toBe(Math.max(1, Math.min(s.startCount, Math.ceil(s.hp / perShip))));
    }
  });
});

describe("фаза противника («Завершить ход»)", () => {
  it("ИИ реально атакует, а не только двигается", () => {
    for (const seed of [7, 42, 3]) {
      const b = freshBattle(seed);
      const hp0 = fpOf(b, "player");
      const attackers = new Set<string>();
      for (let i = 0; i < 6 && b.phase === "battle"; i++) {
        const before = b.log.length;
        playIdlePhase(b);
        for (const e of b.log.slice(before)) {
          if (e.kind === "damage" && e.text.startsWith("Враг:")) {
            const m = e.text.match(/«([^»]+)»/);
            if (m && m[1]) attackers.add(m[1]);
          }
        }
      }
      expect(fpOf(b, "player")).toBeLessThan(hp0);
      expect(attackers.size).toBeGreaterThanOrEqual(3);
    }
  });

  it("ход возвращается игроку после фазы ИИ", () => {
    const b = freshBattle(7);
    v2EndPhase(b); // игрок завершил ход
    expect(b.turnSide).toBe("enemy");
    v2AiPhase(b);
    expect(b.phase === "result" || b.turnSide === "player").toBe(true);
  });

  it("ответный удар срабатывает каждый раунд, а не один раз за бой", () => {
    const b = freshBattle(7);
    const p = b.stacks.find((s) => s.side === "player")!;
    const e = b.stacks.find((s) => s.side === "enemy")!;
    p.q = 6; p.r = 5; e.q = 7; e.r = 5;
    const hpBefore = p.hp;
    expect(v2Attack(b, p.id, e.id, false)).toBe(true);
    expect(p.hp).toBeLessThan(hpBefore);
    v2EndPhase(b);
    v2AiPhase(b);
    expect(e.counterUsed).toBe(false);
  });

  it("завершение хода сжигает остаток AP и пишет это в лог", () => {
    const b = freshBattle(7);
    v2EndPhase(b);
    expect(b.log.some((e) => e.text.startsWith("Сожжено AP"))).toBe(true);
    expect(b.stacks.filter((s) => s.side === "player").every((s) => apOf(s) === 2 || s.side !== "player")).toBe(true);
  });

  it("раунд увеличивается, а первая сторона чередуется", () => {
    const b = freshBattle(7);
    const first = b.firstSide;
    v2EndPhase(b);
    v2AiPhase(b);
    if (b.phase === "battle") {
      expect(b.firstSide).not.toBe(first);
      expect(b.round).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("движение", () => {
  it("нельзя закончить движение в занятом гексе, но можно пройти мимо союзника", () => {
    const b = freshBattle(7);
    const p2 = b.stacks.find((s) => s.id === "p2")!;
    const p4 = b.stacks.find((s) => s.id === "p4")!;
    const spots = reachable(b, p2.id);
    expect(spots.some((h) => h.q === p4.q && h.r === p4.r)).toBe(false);
    expect(spots.some((h) => distance(h, p2) >= 3)).toBe(true);
  });

  it("движение тратит 1 AP", () => {
    const b = freshBattle(7);
    const p = b.stacks.find((s) => s.side === "player" && apOf(s) > 0)!;
    if (b.turnSide !== "player") return;
    const spot = reachable(b, p.id)[0];
    if (!spot) return;
    const ap0 = apOf(p);
    expect(v2Move(b, p.id, spot.q, spot.r)).toBe(true);
    expect(apOf(p)).toBe(ap0 - 1);
  });
});

describe("авто-бой и паритет", () => {
  it("авто-бой завершается и не зависает", () => {
    const b = freshBattle(11);
    const t0 = Date.now();
    runAutoBattle(b);
    expect(b.phase).toBe("result");
    expect(b.result).not.toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("зеркальный бой не даёт 100/0 — выигрывают обе стороны", () => {
    const wins: Record<string, number> = { player: 0, enemy: 0, draw: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      const b = freshBattle(seed);
      runAutoBattle(b);
      const w = b.result!.winner;
      wins[w] = (wins[w] ?? 0) + 1;
      expect(b.phase).toBe("result");
    }
    expect(wins.player ?? 0).toBeGreaterThanOrEqual(5);
    expect(wins.enemy ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("победитель согласуется с остатком сил", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const b = freshBattle(seed);
      runAutoBattle(b);
      const r = b.result!;
      if (r.winner === "player") expect(fpOf(b, "enemy")).toBeLessThanOrEqual(fpOf(b, "player"));
      if (r.winner === "enemy") expect(fpOf(b, "player")).toBeLessThanOrEqual(fpOf(b, "enemy"));
      expect(r.lossFraction?.player).toBeGreaterThanOrEqual(0);
      expect(r.lossFraction?.enemy).toBeGreaterThanOrEqual(0);
    }
  });

  it("«≈ авторезолв по потерям» берётся из формулы, а не подгоняется под факт", () => {
    const b = freshBattle(7);
    runAutoBattle(b);
    const r = b.result!;
    expect(r.parity.autoMax - r.parity.autoMin).toBe(20); // коридор ±10% (16b §8.6)
    expect(r.parity.actual).toBe(Math.round(((r.lossFraction!.player + r.lossFraction!.enemy) / 2) * 100));
  });
});

describe("определённость", () => {
  it("один seed + одинаковый набор действий = одинаковый итог", () => {
    const hash = (b: Battle): string => JSON.stringify({ w: b.result!.winner, l: b.result!.losses, r: b.round });
    const b1 = freshBattle(7); runAutoBattle(b1);
    const b2 = freshBattle(7); runAutoBattle(b2);
    expect(hash(b1)).toBe(hash(b2));
  });

  it("clone не ломает бой", () => {
    const b = freshBattle(7);
    const c = clone(b);
    v2EndPhase(c);
    expect(b.turnSide).toBe("player");
    expect(c.turnSide).toBe("enemy");
  });
});
