// Рендер вариантов «Михраб» (G1–G3) в PNG: node render-mihrab.mjs <путь к playwright/index.mjs>
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.argv[2]);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
await p.goto('file://' + resolve(here, 'mihrab.html'));
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(500);
for (const id of ["G1","G2","G3"]) {
  await p.locator('#' + id).screenshot({ path: resolve(here, `mihrab-${id}.png`) });
}
await b.close();
