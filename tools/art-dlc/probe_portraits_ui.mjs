import { chromium } from "@playwright/test";
const BASE = process.env.SF_BASE_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const failed = [];
page.on("response", (r) => { if (r.status() >= 400) failed.push(r.status() + " " + r.url()); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.innerText.trim().length > 20, undefined, { timeout: 30000 });
// 1) все ассеты манифеста: 200 + decode
const assets = await page.evaluate(async () => {
  const m = await (await fetch("/dlc/manifest.json")).json();
  const bad = [];
  for (const a of m.assets) {
    const url = "/dlc/" + a.path;
    const resp = await fetch(url);
    const blob = await resp.blob();
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res({ ok: true, w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ ok: false, w: 0, h: 0 }); i.src = url; });
    if (resp.status !== 200 || !img.ok || (a.width && (img.w !== a.width || img.h !== a.height))) bad.push({ path: a.path, status: resp.status, img });
  }
  return { total: m.totalBytes, count: m.assets.length, characters: (m.characters || []).map((c) => c.id), bad };
});
console.log("ASSETS:", JSON.stringify(assets));
// 2) кампанийный диалог: адмирал и советник
const started = await page.evaluate(() => {
  const g = window.__SF_GAME__;
  g.newGame(42, "campaign");
  const tries = [
    { type: "dlc_dialogue_start", sceneId: "dlg_campaign_act2", questId: "q_pro_06_echo_core" },
    { type: "dlc_dialogue_start", sceneId: "dlg_campaign_act2" },
  ];
  const out = [];
  for (const cmd of tries) { try { out.push({ cmd: cmd.questId ?? "no-quest", ok: g.sendCommand(cmd) }); if (out[out.length - 1].ok) break; } catch (e) { out.push({ err: String(e).slice(0, 80) }); } }
  return { out, dialogue: g.world.fg?.dlc?.dialogue ?? null };
});
console.log("START:", JSON.stringify(started));
const overlay = page.locator('[data-testid="dialogue-overlay"]');
await overlay.waitFor({ state: "visible", timeout: 15000 });
const info1 = await page.evaluate(() => {
  const img = document.querySelector('[data-testid="dialogue-portrait"] img');
  const who = document.querySelector('[data-testid="dialogue-speaker"]');
  return { src: img?.getAttribute("src"), w: img?.naturalWidth, speaker: who?.textContent };
});
console.log("NODE1:", JSON.stringify(info1));
await page.screenshot({ path: "docs/shots/dlc-ui-dialog.png" });
// продвинуться до советника (n02)
await page.evaluate(() => { const g = window.__SF_GAME__; g.sendCommand({ type: "dlc_dialogue_advance" }); });
await page.waitForTimeout(500);
const info2 = await page.evaluate(() => {
  const img = document.querySelector('[data-testid="dialogue-portrait"] img');
  const who = document.querySelector('[data-testid="dialogue-speaker"]');
  return { src: img?.getAttribute("src"), w: img?.naturalWidth, speaker: who?.textContent };
});
console.log("NODE2:", JSON.stringify(info2));
await page.screenshot({ path: "docs/shots/dlc-ui-dialog-selen.png" });
console.log("FAILED:", JSON.stringify(failed.filter((u) => u.includes("/dlc/"))));
await browser.close();
console.log("PORTRAIT-UI-PROBE-DONE");
