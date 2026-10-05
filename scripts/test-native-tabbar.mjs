#!/usr/bin/env node
/**
 * test-native-tabbar.mjs — логика моста к системной панели вкладок iOS 26
 * (src/lib/nativeTabBar.ts) без устройства.
 *
 * Что проверяется и почему это нельзя увидеть в браузере. На вебе мост
 * всегда в веб-режиме, а на iPhone ошибка видна только как мигнувшая или
 * пропавшая панель. Здесь нативные модули подменены заглушками
 * (scripts/mocks/), и проверяется журнал вызовов к плагину:
 *   • iOS 26 — системная панель; iOS 18 и сбои плагина — веб-капсула;
 *   • до растворения заставки панель не показывается;
 *   • «скрыть и сразу показать» (смена вкладки) не доходит до плагина;
 *   • сбой показа откатывает в веб-режим и пересчитывает геометрию;
 *   • открытая нижняя шторка прячет панель, закрытие всех — возвращает;
 *   • цвет выбранной вкладки равен --brand из src/index.css.
 *
 * Запуск: npm test (после test-audio-model).
 */

import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./mocks/native-tabbar-hooks.mjs', import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MODULE = pathToFileURL(resolve(ROOT, 'src/lib/nativeTabBar.ts')).href;

// Минимальные window/document: модулю нужны таймеры, resize и стиль <html>.
const cssVars = {};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.document = {
  documentElement: { style: { setProperty: (k, v) => { cssVars[k] = v; } } },
};

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

/** Дать отработать таймеру склейки и цепочке промисов моста. */
const settle = () => new Promise(r => setTimeout(r, 5));

let instance = 0;
/** Свежий экземпляр модуля (у него состояние на уровне модуля). */
async function fresh(setup) {
  globalThis.__nativeMock = {
    platform: 'ios', plugins: ['TabBar'], osVersion: '26.1', failOn: [], calls: [], local: [], emit: null,
    ...setup,
  };
  instance += 1;
  return import(`${MODULE}?case=${instance}`);
}

const TABS_CALL = 'setTabs:"player=play.circle.fill,quran=book.fill,azkar=moon.fill"';

// 1. iOS 26: системная панель, показ только после заставки.
{
  const m = await fresh();
  same('iOS: до выяснения режим pending', m.getTabBarMode(), 'pending');
  await m.initNativeTabBar();
  same('iOS 26: режим native', m.getTabBarMode(), 'native');
  same('iOS 26: геометрия — 0 сверх безопасной зоны', cssVars['--tabbar-space'], '0px');
  same('iOS 26: верх панели = безопасная зона', cssVars['--tabbar-top'], 'env(safe-area-inset-bottom)');
  m.setNativeTabBarVisible(true);
  await settle();
  same('до заставки панель не показана', __nativeMock.calls, [TABS_CALL, 'listen:tabSelected']);
  m.markLaunchFaded();
  await settle();
  same('после заставки — ровно один show', __nativeMock.calls.slice(2), ['show']);
  // 2026-10-05: «слишком низко… подними» — штатное место iOS, смещение 0.
  same('после показа панель на штатном месте (смещение 0)', __nativeMock.local, ['TabBarOffset.apply:{"y":0}']);

  // Смена вкладки: размонтирование и монтирование в одном коммите.
  __nativeMock.calls.length = 0;
  m.setNativeTabBarVisible(false);
  m.setNativeTabBarVisible(true);
  await settle();
  same('скрыть+показать подряд не доходит до плагина', __nativeMock.calls, []);

  // Уход на суру и возврат.
  m.setNativeTabBarVisible(false);
  await settle();
  m.setNativeTabBarVisible(true);
  await settle();
  same('уход и возврат — hide, затем show', __nativeMock.calls, ['hide', 'show']);

  // Нижняя шторка поверх экрана вкладок: панель уходит и возвращается.
  __nativeMock.calls.length = 0;
  const release = m.suppressNativeTabBar();
  await settle();
  same('шторка открыта — панель спрятана', __nativeMock.calls, ['hide']);
  const releaseSecond = m.suppressNativeTabBar();
  release();
  release();
  await settle();
  same('одна из двух шторок закрыта (и дважды) — панель ещё спрятана', __nativeMock.calls, ['hide']);
  releaseSecond();
  await settle();
  same('все шторки закрыты — панель вернулась', __nativeMock.calls, ['hide', 'show']);

  // Тап по системной панели доходит до обработчика.
  const taps = [];
  m.setNativeTabSelectHandler(id => taps.push(id));
  __nativeMock.emit({ id: 'azkar' });
  same('тап по системной вкладке передан приложению', taps, ['azkar']);
  m.setNativeTabSelectHandler(null);
  __nativeMock.emit({ id: 'quran' });
  same('без обработчика тап не падает и не доходит', taps, ['azkar']);

  // Цвет выбранной вкладки по теме, без повторов.
  __nativeMock.calls.length = 0;
  m.tintNativeTabBar('light');
  m.tintNativeTabBar('aurora');
  m.tintNativeTabBar('dark');
  m.tintNativeTabBar('cosmos');
  same('цвет: светлые → #7c6340, тёмные → #dcc5a3, без повторов',
    __nativeMock.calls, ['colors:"#7c6340"', 'colors:"#dcc5a3"']);

  m.selectNativeTab('azkar');
  same('выбор вкладки уходит в плагин', __nativeMock.calls.at(-1), 'select:"azkar"');
}

// 2. iOS 18: веб-капсула, плагин не трогается.
{
  const m = await fresh({ osVersion: '18.6' });
  await m.initNativeTabBar();
  same('iOS 18: режим web', m.getTabBarMode(), 'web');
  same('iOS 18: плагин не вызывался', __nativeMock.calls, []);
  same('iOS 18: геометрия веб-капсулы', cssVars['--tabbar-space'], '72px');
}

// 3. Плагина нет в сборке — веб-капсула.
{
  const m = await fresh({ plugins: [] });
  await m.initNativeTabBar();
  same('нет плагина: режим web', m.getTabBarMode(), 'web');
}

// 4. Неизвестный символ (setTabs падает) — веб-капсула, а не пустой низ.
{
  const m = await fresh({ failOn: ['setTabs'] });
  await m.initNativeTabBar();
  same('сбой setTabs: режим web', m.getTabBarMode(), 'web');
}

// 5. Сбой показа — откат в веб-режим с геометрией капсулы.
{
  const m = await fresh({ failOn: ['show'] });
  await m.initNativeTabBar();
  const seen = [];
  m.subscribeTabBarMode(() => seen.push(m.getTabBarMode()));
  m.markLaunchFaded();
  m.setNativeTabBarVisible(true);
  await settle();
  same('сбой show: режим web', m.getTabBarMode(), 'web');
  same('сбой show: подписчики узнали', seen, ['web']);
  same('сбой show: геометрия веб-капсулы', cssVars['--tabbar-top'],
    'calc(max(6px, calc(env(safe-area-inset-bottom) - 10px)) + 62px)');
}

// 6. Android и веб: сразу веб-режим, init ничего не делает.
{
  const m = await fresh({ platform: 'android' });
  same('Android: режим web без init', m.getTabBarMode(), 'web');
  await m.initNativeTabBar();
  same('Android: плагин не вызывался', __nativeMock.calls, []);
}

// 7. Цвет в коде равен --brand в index.css.
{
  const m = await fresh();
  const css = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8');
  // Блок токенов бренда: список тем, затем сразу --brand.
  const brandOf = themes => {
    const selector = themes.map(t => `\\[data-theme="${t}"\\]`).join(',\\s*');
    const match = css.match(new RegExp(`${selector}\\s*\\{\\s*--brand:\\s*(#[0-9a-fA-F]{6})`));
    return match?.[1]?.toLowerCase();
  };
  same('BRAND_HEX.light = --brand светлых тем', m.BRAND_HEX.light, brandOf(['light', 'aurora']));
  same('BRAND_HEX.dark = --brand тёмных тем', m.BRAND_HEX.dark, brandOf(['dark', 'aurora2', 'cosmos']));
}

if (failures) {
  console.error(`\nnative tab bar: ${failures} провал(ов), ${passed} прошло`);
  process.exit(1);
}
console.log(`✓ native tab bar: ${passed} проверок`);
