import { chromium } from "@playwright/test";

const [url, out = "shot.png", waitMs = "2500", viewport = "1600x900"] = process.argv.slice(2);
if (!url) {
  console.error("usage: node tools/shot.mjs <url> <out.png> [waitMs] [WxH]");
  process.exit(1);
}
const [vw, vh] = viewport.split("x").map(Number);
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: vw || 1600, height: vh || 900 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log("[console]", m.type(), m.text());
});
page.on("pageerror", (e) => { errors.push(e.message); console.log("[pageerror]", e.message); });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out });
console.log("saved", out, "errors:", errors.length);
await browser.close();
