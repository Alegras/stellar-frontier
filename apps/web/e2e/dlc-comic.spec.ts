import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { attachDiagnostics, expectNoErrors, gotoGame } from "./helpers";

const SHOTS = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
const shot = (n: string): string => SHOTS + n;
const VIEWPORTS = [{ width: 1280, height: 720 }, { width: 1600, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }];

test.describe("DLC XIV · комикс-панель", () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(180_000);

  test("DOM-пузыри внутри арта, без наложения на портрет/историю, 4 разрешения", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoGame(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { hasWorld: boolean; newGame: (n?: number) => void } }).__SF_GAME__!;
      if (!g.hasWorld) g.newGame(42);
    });
    await expect(page.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15_000 });
    // переводим диалог на узел с комиксом
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { world: { fg: { dlc: { dialogue: Record<string, unknown> } }; tick: number; seed: number }; toast?: (t: string) => void } }).__SF_GAME__!;
      const d = g.world.fg.dlc;
      d.dialogue = {
        sceneId: "dlg_q1_briefing", nodeId: "n07", active: true, history: [], checkResults: {}, choices: {},
        startedTick: g.world.tick, questId: "q_pro_01_first_light", seed: g.world.seed, appliedEffects: [], visited: { n07: 1 },
        nodeStartedTick: g.world.tick, context: "dlc",
      };
      g.toast?.("comic");
    });
    await page.waitForTimeout(700);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(350);
      // чистим уведомления и ставим паузу, чтобы сцена была статичной
      await page.evaluate(() => {
        const g = (window as unknown as {
          __SF_GAME__?: { getState: () => { paused: boolean; notices: Array<{ id: number }> }; togglePause: () => void; dismissNotice: (id: number) => void };
        }).__SF_GAME__;
        if (!g) return;
        if (!g.getState().paused) g.togglePause();
        for (const n of g.getState().notices) g.dismissNotice(n.id);
      });
      const info = await page.evaluate(() => {
        const r = (el: Element | null) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
        const wrap = document.querySelector('[data-testid="dialogue-comic"]');
        const b1 = document.querySelector('[data-testid="dialogue-comic-bubble-1"]');
        const b2 = document.querySelector('[data-testid="dialogue-comic-bubble-2"]');
        const portrait = document.querySelector('[data-testid="dialogue-portrait"]');
        const main = document.querySelector(".sf-dlg__main");
        const footer = document.querySelector(".sf-dlg__foot");
        const bg = b1 ? getComputedStyle(b1).backgroundColor : "";
        return { wrap: r(wrap), b1: r(b1), b2: r(b2), portrait: r(portrait), main: r(main), footer: r(footer), bg, t1: b1?.textContent ?? "", t2: b2?.textContent ?? "" };
      });
      expect(info.b1, "bubble 1 @" + vp.width).not.toBeNull();
      expect(info.b2, "bubble 2 @" + vp.width).not.toBeNull();
      expect(info.t1.length).toBeGreaterThan(0);
      expect(info.t2.length).toBeGreaterThan(0);
      expect(info.bg).not.toBe("rgba(0, 0, 0, 0)");
      // пузыри внутри картинки, не перекрываются и не залезают на портрет/главную колонку
      for (const b of [info.b1!, info.b2!]) {
        expect(b!.x).toBeGreaterThanOrEqual(info.wrap!.x - 1);
        expect(b!.y).toBeGreaterThanOrEqual(info.wrap!.y - 1);
        expect(b!.right).toBeLessThanOrEqual(info.wrap!.right + 1);
        expect(b!.bottom).toBeLessThanOrEqual(info.wrap!.bottom + 1);
      }
      expect(info.b1!.right).toBeLessThan(info.b2!.x);
      expect(info.portrait!.right, "portrait не залезает на main @" + vp.width).toBeLessThanOrEqual(info.main!.x + 2);
      expect(info.wrap!.x, "comic внутри main @" + vp.width).toBeGreaterThanOrEqual(info.main!.x - 1);
      // история ниже комикса: раскрываем и проверяем отсутствие наложения
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="dialogue-history-toggle"]')?.click());
      await page.waitForTimeout(200);
      const hist = await page.evaluate(() => {
        const h = document.querySelector('[data-testid="dialogue-history"]');
        const f = document.querySelector(".sf-dlg__foot");
        const w = document.querySelector('[data-testid="dialogue-comic"]');
        const rr = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right }; };
        return { history: rr(h), footer: rr(f), wrap: rr(w) };
      });
      if (hist.history) {
        // меряем после раскрытия истории — скролл мог сдвинуть футер
        expect(hist.history.y, "history не поверх комикса @" + vp.width).toBeGreaterThanOrEqual(hist.wrap!.bottom - 1);
        expect(hist.history.y, "history ниже футера @" + vp.width).toBeGreaterThanOrEqual(hist.footer!.bottom - 2);
      }
      if (vp.width === 1280 || vp.width === 2560) {
        await page.screenshot({ path: shot("dlc-comic-dom-" + vp.width + ".png") });
        await page.locator('[data-testid="dialogue-comic"]').screenshot({ path: shot("dlc-comic-" + vp.width + ".png") });
      }
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="dialogue-history-toggle"]')?.click());
    }
    if (await page.locator('[data-testid="dialogue-comic"]').count()) {
      await page.locator('[data-testid="dialogue-comic"]').screenshot({ path: shot("dlc-comic.png") });
    }

    // ключевой арт доступен и не пустой
    for (const url of ["/dlc/comics/q_pro_01_first_light_01.png", "/dlc/cards/q_pro_01_first_light.png", "/dlc/backgrounds/station_light_1.png", "/dlc/portraits/teira_os/neutral.png", "/dlc/voices/svet_wave.png"]) {
      const res = await page.request.get(url);
      expect(res.status(), url).toBe(200);
      expect((await res.body()).length, url).toBeGreaterThan(300);
    }
    expectNoErrors(diag);
  });
});
