#!/usr/bin/env node
/**
 * test-tab-swipe.mjs — лента корневых вкладок на нативной прокрутке
 * (src/lib/tabStrip.ts, src/components/TabPager.tsx) без браузера.
 *
 * С 2026-10-05 вкладки листает сам iOS: лента — горизонтальная прокрутка с
 * привязкой, своей физики нет (владелец на iPhone: «происходит дёргание»;
 * то же решение an-Nur принял для мусхафа 14.09.2026). Здесь проверяется:
 *   • шаг ленты целый — дробная ширина давала набегающую ошибку;
 *   • вкладка ↔ прокрутка взаимно обратны, середина решает в пользу той
 *     страницы, что занимает больше экрана, резинка не выводит за края;
 *   • доля пути между вкладками — для панелей, видимых не везде;
 *   • остановка — в допуске от страницы: запаздывание WebKit (−10…+7 px)
 *     считается остановкой, палец посреди перелистывания — нет;
 *   • 🔴 страж: самодельная физика листания не вернулась.
 *
 * Запуск: npm test (после test-native-tabbar).
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const m = await import(pathToFileURL(resolve(ROOT, 'src/lib/tabStrip.ts')).href);

let failures = 0;
let passed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed += 1; return; }
  failures += 1;
  console.error(`✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
const same = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);

const W = 390;
const N = 3; // Плеер | Коран | Азкары

// 1. Шаг — целый.
same('шаг — ширина ленты', m.tabStep(390), 390);
same('дробная ширина — целый шаг', m.tabStep(412.5), 412);
same('нулевая ширина — шага нет', m.tabStep(0), 0);
same('не число — шага нет', m.tabStep(Number.NaN), 0);
{
  // Набегающая ошибка: на целом шаге каждая вкладка встаёт ровно в точку.
  const step = m.tabStep(412.5);
  let off = 0;
  for (let i = 0; i < N; i++) if (m.scrollLeftForTab(i, step) % 1 !== 0) off++;
  same('координаты вкладок целые', off, 0);
}

// 2. Вкладка ↔ прокрутка.
{
  let diverge = 0;
  for (let i = 0; i < N; i++) if (m.tabAtScrollLeft(m.scrollLeftForTab(i, W), W, N) !== i) diverge++;
  same('вкладка → прокрутка → та же вкладка', diverge, 0);
}
same('чуть сдвинули — вкладка прежняя', m.tabAtScrollLeft(W + W * 0.4, W, N), 1);
same('больше половины — уже следующая', m.tabAtScrollLeft(W + W * 0.6, W, N), 2);
same('резинка за левым краем — первая', m.tabAtScrollLeft(-120, W, N), 0);
same('резинка за правым краем — последняя', m.tabAtScrollLeft(W * 2 + 150, W, N), 2);
same('нулевой шаг не делит на ноль', m.tabAtScrollLeft(500, 0, N), 0);

// 3. Доля пути между вкладками.
same('на вкладке — пути нет', m.tabProgress(W, W, N), { from: 1, to: 2, t: 0 });
same('четверть пути от «Корана» к «Азкарам»', m.tabProgress(W * 1.25, W, N), { from: 1, to: 2, t: 0.25 });
same('на последней — дальше некуда', m.tabProgress(W * 2, W, N), { from: 2, to: 2, t: 0 });
same('резинка за краями не выводит долю за ленту', m.tabProgress(-50, W, N), { from: 0, to: 1, t: 0 });

// 4. Остановка.
{
  const tol = m.tabSettleTolerance(W);
  check('на вкладке лента выровнена', m.isTabAligned(W, W));
  check('посередине — нет', !m.isTabAligned(W * 1.5, W));
  check('полпикселя дрожи — ещё выровнена', m.isTabAligned(W + 0.5, W));
  check('запаздывание WebKit в 10 px — лента стоит', m.isTabAligned(W - 10, W, tol));
  // Хвост привязки (владелец 2026-10-07, стенд lab/tab-swipe).
  check('хвост: доезжает 25 → 19 px до «Корана» — досадить', m.snapTailTarget(W + 19, W, 3, W + 25) === W);
  check('хвост с другой стороны — тоже', m.snapTailTarget(W - 12, W, 3, W - 20) === W);
  check('бросок: в 23 px от исходной, но улетает от неё — НЕ трогать (иначе свайп отменится)',
    m.snapTailTarget(W + 23, W, 3, W + 20) === null);
  check('без прошлого положения — не трогать', m.snapTailTarget(W + 10, W, 3, Number.NaN) === null);
  check('уже стоит — не трогать', m.snapTailTarget(W, W, 3, W + 3) === null);
  check('посреди листания — не трогать', m.snapTailTarget(W * 1.5, W, 3, W * 1.6) === null);
  check('резинка за левым краем — не трогать', m.snapTailTarget(-15, W, 3, -20) === null);
  check('резинка за правым краем — не трогать', m.snapTailTarget(2 * W + 15, W, 3, 2 * W + 20) === null);
  check('и +7 px — тоже', m.isTabAligned(W + 7, W, tol));
  check('палец посреди перелистывания — не стоит', !m.isTabAligned(W + W * 0.3, W, tol));
  same('допуск не меньше 16 px даже на узком экране', m.tabSettleTolerance(100), 16);
}

// 5. 🔴 Страж: своей физики листания нет — листает системная прокрутка.
// Прежний пейджер вёл листы пальцем через transform и доводил CSS-переходом;
// на iPhone это дёргалось. Возврат любого из этих путей ловится здесь.
{
  const pager = readFileSync(resolve(ROOT, 'src/components/TabPager.tsx'), 'utf8');
  // Код без комментариев: в шапке файла история прежних решений упоминает
  // запрещённые приёмы словами.
  const code = pager
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  check('лента — нативная прокрутка с привязкой к вкладкам',
    /scrollSnapType:\s*'x mandatory'/.test(code) && /scrollSnapStop:\s*'always'/.test(code)
      && /overflowX:\s*'auto'/.test(code));
  check('пейджер не ведёт листы пальцем (touchmove)', !/touchmove/.test(code));
  check('пейджер не гасит прокрутку (preventDefault)', !/preventDefault/.test(code));
  check('пейджер не двигает листы transform', !/translate3d|translateX|\.style\.transform/.test(code));
  check('пейджер не анимирует сам (Web Animations, переходы)', !/\.animate\(|transition/.test(code));
  check('самодельная физика (tabSwipe.ts) удалена', !existsSync(resolve(ROOT, 'src/lib/tabSwipe.ts')));
}

if (failures) {
  console.error(`\ntest-tab-swipe: ${failures} провал(ов), ${passed} прошло`);
  process.exit(1);
}
console.log(`test-tab-swipe: все ${passed} проверок прошли`);
