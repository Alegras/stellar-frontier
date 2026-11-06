import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const failed = [];
page.on("response", (r) => { if (r.status() >= 400) failed.push(r.status() + " " + r.url()); });
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded" });
const gif = await page.evaluate(async () => {
  const url = "/menu/stellar-battle.gif";
  const resp = await fetch(url);
  const blob = await resp.blob();
  const img = await new Promise((res) => { const i = new Image(); i.onload = () => res({ ok: true, w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ ok: false }); i.src = url; });
  const poster = await fetch("/menu/stellar-battle-poster.png");
  const pimg = await new Promise((res) => { const i = new Image(); i.onload = () => res({ ok: true, w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ ok: false }); i.src = "/menu/stellar-battle-poster.png"; });
  return { status: resp.status, type: resp.headers.get("content-type"), bytes: blob.size, img, posterStatus: poster.status, posterBytes: (await poster.blob()).size, pimg };
});
console.log("MENU:", JSON.stringify(gif));
console.log("FAILED:", JSON.stringify(failed));
await browser.close();
