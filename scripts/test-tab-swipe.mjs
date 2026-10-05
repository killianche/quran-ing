#!/usr/bin/env node
/**
 * test-tab-swipe.mjs — правила свайпа между вкладками (src/lib/tabSwipe.ts)
 * без браузера.
 *
 * На телефоне ошибка в этих числах выглядит как «иногда не листается» или
 * «листается от прокрутки списка» и глазами не ловится. Здесь проверяется:
 *   • направление выбирается только после порога и только при явной
 *     горизонтали (вертикальная прокрутка списка не перехватывается);
 *   • за крайней вкладкой — резинка, дальше ширины экрана страница не уходит;
 *   • отпускание: дальше 35 % или флик — перелистнуть, иначе вернуть;
 *     взмах назад отменяет; за крайнюю вкладку не листается никогда;
 *   • скорость считается по последнему взмаху, а не по всему жесту.
 *
 * Запуск: npm test (после test-native-tabbar).
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const m = await import(pathToFileURL(resolve(__dirname, '../src/lib/tabSwipe.ts')).href);

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

// 1. Направление.
same('до порога направление не выбрано', m.lockAxis(6, 3), null);
same('явная горизонталь', m.lockAxis(-12, 4), 'horizontal');
same('явная вертикаль', m.lockAxis(3, 14), 'vertical');
same('равный сдвиг отдаётся прокрутке', m.lockAxis(11, 11), 'vertical');
same('диагональ чуть круче 45° — прокрутка', m.lockAxis(10, 12), 'vertical');
same('порог считается и по вертикали', m.lockAxis(2, -10), 'vertical');

// 2. Сдвиг под пальцем и резинка.
same('к соседу — один к одному', m.dragOffset(-120, W, false, true), -120);
same('к соседу — не дальше ширины', m.dragOffset(-500, W, false, true), -W);
{
  const r = m.dragOffset(120, W, false, true);
  check('без соседа — резинка: меньше пальца', r > 0 && r < 120, `получено ${r}`);
  const far = m.dragOffset(5000, W, false, true);
  check('резинка не уводит дальше ширины', far > 0 && far < W, `получено ${far}`);
  const left = m.dragOffset(-120, W, true, false);
  check('резинка симметрична', Math.abs(left + r) < 1e-9, `${left} против ${r}`);
  const a = m.rubberBand(50, W);
  const b = m.rubberBand(100, W);
  check('резинка тянется всё туже', b - a < a, `${a}, ${b}`);
}
same('нулевой сдвиг', m.dragOffset(0, W, true, true), 0);

// 3. Скорость.
{
  const samples = [
    { t: 0, x: 300 }, { t: 400, x: 280 }, // долгое медленное ведение
    { t: 460, x: 250 }, { t: 500, x: 200 }, // резкий взмах влево
  ];
  const v = m.velocityOf(samples);
  // Средняя за весь жест −0,2 px/мс; за последние 100 мс — −0,8.
  check('скорость — по последнему взмаху', Math.abs(v + 0.8) < 1e-9, `получено ${v}`);
  // Отпускание через 200 мс на том же месте — палец постоял.
  same('палец постоял перед отпусканием — скорости нет',
    m.velocityOf([...samples, { t: 700, x: 200 }]), 0);
  same('одна точка — скорости нет', m.velocityOf([{ t: 0, x: 0 }]), 0);
  // Редкие события (между ними больше окна) — берём хотя бы соседнюю пару.
  const sparse = m.velocityOf([{ t: 0, x: 300 }, { t: 30, x: 240 }]);
  check('две точки в окне — скорость есть', Math.abs(sparse + 2) < 1e-9, `получено ${sparse}`);
}

// 4. Решение на отпускании (+1 — следующая вкладка, −1 — предыдущая).
const release = (offset, velocity, hasPrev = false, hasNext = true) =>
  m.releaseTarget({ offset, velocity, width: W, hasPrev, hasNext });
same('протащили дальше 35 % — листаем', release(-0.4 * W, 0), 1);
same('меньше 35 % без флика — возврат', release(-0.3 * W, 0), 0);
same('короткий быстрый флик — листаем', release(-40, -0.8), 1);
same('флик короче минимума — возврат', release(-10, -2), 0);
same('медленно и недалеко — возврат', release(-60, -0.2), 0);
same('взмах назад отменяет даже далёкий сдвиг', release(-0.6 * W, 0.9), 0);
same('за крайнюю вкладку не листается', release(0.9 * W, 2, false, true), 0);
same('вправо к предыдущей', release(0.5 * W, 0, true, false), -1);
same('флик вправо к предыдущей', release(50, 0.7, true, false), -1);
same('нулевой сдвиг — на месте', release(0, -3), 0);

// 5. Средняя вкладка (с 2026-10-05 их три: Плеер | Коран | Азкары) —
// соседи с обеих сторон, резинки нет ни там, ни там.
same('середина: влево один к одному', m.dragOffset(-150, W, true, true), -150);
same('середина: вправо один к одному', m.dragOffset(150, W, true, true), 150);
same('середина: вправо не дальше ширины', m.dragOffset(900, W, true, true), W);
same('середина: дальше 35 % влево — следующая', release(-0.5 * W, 0, true, true), 1);
same('середина: дальше 35 % вправо — предыдущая', release(0.5 * W, 0, true, true), -1);
same('середина: флик вправо — предыдущая', release(40, 0.9, true, true), -1);
same('середина: недотянули — на месте', release(0.2 * W, 0.1, true, true), 0);

if (failures) {
  console.error(`\ntest-tab-swipe: ${failures} провал(ов), ${passed} прошло`);
  process.exit(1);
}
console.log(`test-tab-swipe: все ${passed} проверок прошли`);
