#!/usr/bin/env node
/**
 * make-screenshots — кадры карточки App Store из собранного приложения.
 *
 * Снимает веб-сборку (`dist/`, тот же код, что внутри iOS-приложения) в
 * headless Chromium на точных размерах Apple, без рамок браузера:
 *   iPhone 6.9″ — 440 × 956 pt × 3 = 1320 × 2868;
 *   iPad 13″    — 1032 × 1376 pt × 2 = 2064 × 2752;
 *   Android     — 360 × 720 dp × 3 = 1080 × 2160 (Google Play: сторона
 *                 320–3840 px, вытянутость не больше 2:1 — кадры iPhone
 *                 6.9″ с их 2,17:1 Play не примет). Кладутся в
 *                 play-store/screenshots/phone.
 *
 * Только часть устройств: ONLY=android-phone (через запятую).
 *
 * Кадры (порядок — порядок в магазине):
 *   01-quran  — главная: «Продолжить чтение», поиск, суры;
 *   02-surah  — чтение Аль-Фатихи: арабский, ингушский и русский перевод
 *               (тёмная тема — для разнообразия карточки);
 *   03-tafsir — толкование ас-Саади к аяту;
 *   04-azkar  — утренние азкары;
 *   05-prayer — время намаза;
 *   06-player — плеер суры.
 *
 * Отличие от телефона: внизу веб-капсула вкладок (на iOS 26 там системная
 * панель — в браузере её нет). Строки состояния нет — как у многих карточек.
 *
 * Запуск (сервер разработки, Playwright не входит в зависимости проекта):
 *   npm run build && npx vite preview --port 5292 &
 *   PLAYWRIGHT_CORE=/путь/к/playwright-core node scripts/appstore/make-screenshots.mjs
 */

import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PW = process.env.PLAYWRIGHT_CORE;
if (!PW) throw new Error('Укажите PLAYWRIGHT_CORE — путь к пакету playwright-core.');
const { chromium } = await import(resolve(PW, 'index.mjs'));
const BASE = process.env.BASE_URL ?? 'http://localhost:5292/';

const ALL_DEVICES = [
  { folder: 'iphone-6.9', width: 440, height: 956, scale: 3 },
  { folder: 'ipad-13', width: 1032, height: 1376, scale: 2 },
  { folder: 'android-phone', width: 360, height: 720, scale: 3, out: 'play-store/screenshots/phone' },
];
const ONLY = (process.env.ONLY ?? '').split(',').map(s => s.trim()).filter(Boolean);
const DEVICES = ONLY.length ? ALL_DEVICES.filter(d => ONLY.includes(d.folder)) : ALL_DEVICES;
if (DEVICES.length === 0) throw new Error(`ONLY=${process.env.ONLY}: таких устройств нет`);

/** Недавние для главной — как у человека, который читает несколько сур. */
const RECENTS = [
  { surah: 18, ayah: 10, ts: 4 },
  { surah: 36, ayah: 58, ts: 3 },
  { surah: 67, ayah: 1, ts: 2 },
  { surah: 2, ayah: 255, ts: 1 },
];

async function open(browser, device, theme) {
  const ctx = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.scale,
    isMobile: true,
    hasTouch: true,
  });
  await ctx.addInitScript(([t, recents]) => {
    try {
      localStorage.setItem('theme', t);
      localStorage.setItem('recentReads', JSON.stringify(recents));
    } catch { /* без хранилища — кадр по умолчанию */ }
  }, [theme, RECENTS]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForSelector('#launch', { state: 'detached', timeout: 15000 });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}

/** Клик по центру элемента — как палец, а не программный click(). */
async function tap(page, selector) {
  await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`нет элемента ${sel}`);
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 120), r.top + r.height / 2);
    // Под пальцем может оказаться SVG-значок — жмём его кнопку.
    const target = hit?.closest('button, a, [role="button"]') ?? el;
    (target instanceof HTMLElement ? target : el).click();
  }, selector);
}

/** Ждать, пока арабский текст аятов нарисован шрифтом, а не скелетом. */
async function waitArabic(page) {
  await page.waitForSelector('[data-ayah-anchor]', { timeout: 15000 });
  await page.waitForFunction(() => document.fonts.status === 'loaded'
    && document.querySelectorAll('.qcf-ayah-line').length > 0
    && !document.querySelector('.qcf-ayah-line .skeleton'), null, { timeout: 20000 });
  await page.waitForTimeout(800);
}

async function shoot(page, device, name) {
  const dir = device.out ? resolve(ROOT, device.out) : resolve(ROOT, 'app-store/screenshots', device.folder);
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.screenshot({ path: resolve(dir, `${name}.jpg`), type: 'jpeg', quality: 92 });
  console.log(`✓ ${device.folder}/${name}.jpg`);
}

const browser = await chromium.launch();
const problems = [];
for (const device of DEVICES) {
  // 01 — главная
  {
    const { ctx, page, errors } = await open(browser, device, 'aurora');
    await shoot(page, device, '01-quran');
    problems.push(...errors);
    await ctx.close();
  }
  // 02 — чтение, 03 — тафсир
  {
    const { ctx, page, errors } = await open(browser, device, 'dark');
    await tap(page, '[data-surah="1"]');
    await waitArabic(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await shoot(page, device, '02-surah');
    await tap(page, '[aria-label="Тафсир аята 1:2"]');
    await page.waitForSelector('[data-reading-sheet]', { timeout: 10000 });
    await page.waitForFunction(() => !document.querySelector('[data-reading-sheet] .skeleton'), null, { timeout: 15000 });
    await page.waitForTimeout(900);
    await shoot(page, device, '03-tafsir');
    problems.push(...errors);
    await ctx.close();
  }
  // 04 — азкары
  {
    const { ctx, page, errors } = await open(browser, device, 'aurora');
    await tap(page, 'button[aria-label="Азкары"]');
    await page.waitForSelector('[role="listitem"] button', { timeout: 10000 });
    await tap(page, '[role="listitem"] button');
    await page.waitForTimeout(1800);
    await shoot(page, device, '04-azkar');
    problems.push(...errors);
    await ctx.close();
  }
  // 05 — намаз
  {
    const { ctx, page, errors } = await open(browser, device, 'aurora');
    await tap(page, 'button[aria-label="Намаз"]');
    await page.waitForTimeout(1500);
    await shoot(page, device, '05-prayer');
    problems.push(...errors);
    await ctx.close();
  }
  // 06 — плеер: сура звучит, экран «Слушать»
  {
    const { ctx, page, errors } = await open(browser, device, 'dark');
    await tap(page, '[aria-label="Слушать суру Ар-Рахман целиком"], [aria-label="Слушать суру Аль-Фатиха целиком"]');
    await page.waitForSelector('[aria-label^="Открыть плеер"]', { timeout: 10000 });
    await tap(page, '[aria-label^="Открыть плеер"]');
    await page.waitForSelector('[aria-label="Список сур"]', { timeout: 10000 });
    await page.waitForTimeout(900);
    await shoot(page, device, '06-player');
    problems.push(...errors);
    await ctx.close();
  }
}
await browser.close();
if (problems.length) {
  console.error('Ошибки страницы:', problems);
  process.exit(1);
}
