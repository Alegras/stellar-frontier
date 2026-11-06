import { describe, expect, it } from "vitest";
import { applyCommand, createWorld, tick } from "../src/index";
import { BALANCE, MODE } from "@sf/data";

describe("торговля на станции", () => {
  it("покупка начисляет товар, списывает кредиты и сток; продажа — наоборот", () => {
    const world = createWorld(4242, MODE, BALANCE);
    const player = world.empires.find((e) => e.isPlayer)!;
    const system = world.systems.find((s) => s.id === player.capitalSystemId)!;
    const station = system.station!;
    const good = station.market.energy!;
    const before = {
      energy: player.resources.energy,
      credits: player.resources.credits,
      stock: good.stock,
    };
    const buy = applyCommand(world, { type: "trade", stationId: station.id, good: "energy", qty: 10, buy: true });
    expect(buy.ok).toBe(true);
    expect(player.resources.energy).toBe(before.energy + 10);
    expect(player.resources.credits).toBeLessThan(before.credits);
    expect(good.stock).toBe(before.stock - 10);

    const mid = { energy: player.resources.energy, credits: player.resources.credits, stock: good.stock };
    const sell = applyCommand(world, { type: "trade", stationId: station.id, good: "energy", qty: 10, buy: false });
    expect(sell.ok).toBe(true);
    expect(player.resources.energy).toBe(mid.energy - 10);
    expect(player.resources.credits).toBeGreaterThan(mid.credits);
    expect(good.stock).toBe(mid.stock + 10);
  });

  it("покупка не создаёт ресурсы из воздуха: сумма кредитов/товара согласована", () => {
    const world = createWorld(7, MODE, BALANCE);
    const player = world.empires.find((e) => e.isPlayer)!;
    const system = world.systems.find((s) => s.id === player.capitalSystemId)!;
    const station = system.station!;
    const good = station.market.minerals!;
    const credits0 = player.resources.credits;
    const minerals0 = player.resources.minerals;
    const stock0 = good.stock;
    const res = applyCommand(world, { type: "trade", stationId: station.id, good: "minerals", qty: 5, buy: true });
    expect(res.ok).toBe(true);
    const spent = credits0 - player.resources.credits;
    expect(spent).toBeGreaterThan(0);
    expect(player.resources.minerals - minerals0).toBe(5);
    expect(stock0 - good.stock).toBe(5);
    // сделка учтена в объёме торговли и не даёт магического возврата
    expect(world.tradeVolume).toBeGreaterThanOrEqual(spent);
    tick(world);
    expect(Number.isFinite(player.resources.minerals)).toBe(true);
  });
});
