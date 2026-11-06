import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.evaluate(() => { const g = window.__SF_GAME__; if (g && !g.hasWorld) g.newGame(12345); g.advance?.(1); });
await page.waitForTimeout(1200);
await page.keyboard.press("Escape");
await page.evaluate(() => document.querySelector('[data-testid="btn-open-more"]')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-testid="panel-open-journal"]')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-testid="btn-journal-tab-tree"]')?.click());
await page.waitForTimeout(400);
const info = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="journal-panel"]');
  if (!el) return { found: false };
  const cs = getComputedStyle(el);
  const parent = el.parentElement;
  const pcs = parent ? getComputedStyle(parent) : null;
  const rect = el.getBoundingClientRect();
  return {
    found: true, classes: el.className,
    maxHeight: cs.maxHeight, height: cs.height, overflowY: cs.overflowY,
    rect: { y: rect.y, h: rect.height },
    parent: parent?.className ?? null,
    parentMaxH: pcs?.maxHeight ?? null, parentOverflow: pcs?.overflowY ?? null,
    topbar: getComputedStyle(document.documentElement).getPropertyValue("--sf-topbar-h"),
  };
});
console.log(JSON.stringify(info));
await browser.close();
