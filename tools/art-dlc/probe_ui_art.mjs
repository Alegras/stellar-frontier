import { chromium } from "@playwright/test";
const BASE = process.env.SF_BASE_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const failed = [];
page.on("response", (r) => { if (r.status() >= 400) failed.push(r.status() + " " + r.url()); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.innerText.trim().length > 20, undefined, { timeout: 30000 });

// 1) все ассеты из манифеста: fetch 200 + decode (naturalWidth/Height)
const assets = await page.evaluate(async () => {
  const m = await (await fetch("/dlc/manifest.json")).json();
  const out = [];
  for (const a of m.assets) {
    const url = "/dlc/" + a.path;
    const resp = await fetch(url);
    const blob = await resp.blob();
    const img = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve({ ok: true, w: i.naturalWidth, h: i.naturalHeight });
      i.onerror = () => resolve({ ok: false, w: 0, h: 0 });
      i.src = url;
    });
    out.push({ path: a.path, status: resp.status, type: resp.headers.get("content-type"), bytes: blob.size, img });
  }
  return { total: m.totalBytes, assets: out };
});
console.log("MANIFEST:", JSON.stringify({ total: assets.total, count: assets.assets.length }));
const bad = assets.assets.filter((a) => a.status !== 200 || !a.img.ok || !a.type?.includes("png"));
console.log("ASSETS_BAD:", JSON.stringify(bad));
console.log("SIZES:", JSON.stringify(assets.assets.slice(0, 3)));

// 2) реальный UI: новая кампания → DLC-квест и диалог
const state = await page.evaluate(() => {
  const g = window.__SF_GAME__;
  g.newGame(42, "campaign");
  const fg = g.world.fg;
  return { mode: g.getState().mode, hasDlc: !!fg?.dlc, dlc: fg?.dlc ? Object.keys(fg.dlc) : null, paused: g.getState().paused };
});
console.log("STATE:", JSON.stringify(state));
// запускаем квест+диалог командами, как это делает UI
const started = await page.evaluate(() => {
  const g = window.__SF_GAME__;
  const okQ = g.sendCommand({ type: "dlc_quest_accept", questId: "q_pro_01_first_light", source: "story_message" });
  const okD = g.sendCommand({ type: "dlc_dialogue_start", sceneId: "dlg_q1_briefing", questId: "q_pro_01_first_light" });
  return { okQ, okD, dialogue: g.world.fg?.dlc?.dialogue ?? null };
});
console.log("DIALOGUE START:", JSON.stringify(started));
const overlay = page.locator('[data-testid="dialogue-overlay"]');
const visible = await overlay.isVisible().catch(() => false);
console.log("OVERLAY VISIBLE:", visible);
if (visible) {
  const portrait = await page.evaluate(() => {
    const img = document.querySelector('[data-testid="dialogue-portrait"] img');
    if (!img) return null;
    return { src: img.getAttribute("src"), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, shown: getComputedStyle(img).display };
  });
  console.log("PORTRAIT:", JSON.stringify(portrait));
  await page.screenshot({ path: "docs/shots/dlc-ui-dialog.png" });
}
console.log("FAILED_REQUESTS:", JSON.stringify(failed.filter((u) => u.includes("/dlc/"))));
await browser.close();
console.log("ART-UI-PROBE-DONE");
