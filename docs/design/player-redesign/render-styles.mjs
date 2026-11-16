// Рендер стилей кнопок плеера (F1–F3) в PNG: node render-reciter.mjs <путь к playwright/index.mjs>
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.argv[2]);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
await p.goto('file://' + resolve(here, 'player-styles.html'));
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(500);
for (const id of ["F1","F2","F3"]) {
  await p.locator('#' + id).screenshot({ path: resolve(here, `styles-${id}.png`) });
}
await b.close();
