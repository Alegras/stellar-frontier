import { chromium } from "@playwright/test";
const BASE = "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage();
const failed = [];
page.on("response", (r) => { if (r.status() >= 400) failed.push(r.status() + " " + r.url()); });
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
const res = await page.evaluate(async () => {
  const m = await (await fetch("/battle/manifest.json")).json();
  const paths = [];
  for (const t of Object.values(m.tiles)) paths.push(t.path);
  for (const fac of Object.values(m.units)) for (const u of Object.values(fac)) paths.push(u.path);
  for (const e of Object.values(m.effects)) paths.push(e.path);
  for (const b of Object.values(m.backgrounds)) paths.push(b.path);
  const out = { manifest: { ready: m.ready, pending: m.pending?.length, totalBytes: m.totalBytes, palette: m.palette.length, files: paths.length }, bad: [], ok: 0 };
  for (const p of paths) {
    try {
      const r = await fetch("/battle/" + p);
      if (r.status !== 200) { out.bad.push(p + " status " + r.status); continue; }
      const blob = await r.blob();
      const dims = await new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res(null); i.src = "/battle/" + p; });
      if (!dims || !dims.w) { out.bad.push(p + " decode fail"); continue; }
      out.ok++;
    } catch (e) { out.bad.push(p + " " + e.message); }
  }
  return out;
});
console.log("BATTLE-ASSETS:", JSON.stringify(res));
console.log("FAILED-REQUESTS:", JSON.stringify(failed.filter((u) => u.includes("/battle/"))));
await browser.close();
