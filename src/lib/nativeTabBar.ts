/**
 * nativeTabBar — системная панель вкладок iOS (Liquid Glass) поверх веб-вью.
 *
 * ── Решение владельца (2026-10-04) ─────────────────────────────────────
 *
 * «Если есть возможность, то давай сделаем как настоящую панель». Настоящее
 * стекло iOS 26 — преломление, адаптация к фону под панелью, растворение
 * прокрутки у её кромки — рисует только UIKit; CSS-копия этого не умеет
 * (docs/IOS26_DESIGN_GUIDE.md, § 0 и § 9). Поэтому на iPhone/iPad с iOS 26+
 * внизу лежит настоящий `UITabBar` из плагина `@capawesome/capacitor-tab-bar`
 * (MIT, Capacitor 8), а веб-панель `TabBar` не рисуется.
 *
 * ── Где какая панель ───────────────────────────────────────────────────
 *
 *   iOS 26+   — нативная. Плагин сам кладёт её над веб-вью, поднимает
 *               нижнюю безопасную зону на её высоту (env(safe-area-inset-
 *               bottom) = верх панели) и подключает scroll edge effect.
 *   iOS 15–25 — веб-капсула. Плагин там показал бы классическую панель,
 *               которая следует системной теме, а не теме приложения:
 *               белая полоса под тёмной «Авророй». Стекла, ради которого
 *               всё затевалось, на этих версиях нет.
 *   Android, веб — веб-капсула (у плагина там только заглушки).
 *
 * Пока режим не выяснен (iOS, первые миллисекунды), не рисуется никакая
 * панель: экран в это время закрыт заставкой `#launch`.
 *
 * ── Геометрия для остальных элементов ─────────────────────────────────
 *
 * Модуль выставляет на <html> две переменные, по которым считают отступы
 * экраны вкладок, мини-плеер и плашка отказа звука:
 *
 *   --tabbar-space — место панели СВЕРХ env(safe-area-inset-bottom)
 *                    (у нативной 0: её высота уже внутри безопасной зоны);
 *   --tabbar-top   — расстояние от низа экрана до верхней кромки панели.
 *
 * 🔴 Обе верны только на экранах с панелью. На экранах без неё (сура,
 * намаз) нативная панель скрыта, безопасная зона обычная, и считать надо
 * от env(safe-area-inset-bottom).
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { TabBar as NativeBar } from '@capawesome/capacitor-tab-bar';
import type { TabId } from '../components/TabBar';
import { themeMode, type Theme } from '../hooks/useTheme';

export type TabBarMode = 'pending' | 'native' | 'web';

/** С какой версии iOS берём системную панель — первая с Liquid Glass. */
const MIN_IOS_MAJOR = 26;

/**
 * Насколько системная панель ниже своего места, pt. Владелец 2026-10-04:
 * «кнопки Коран и Азкары сделать ниже, ближе к краю». Штатно капсула стоит
 * ~22 pt над краем экрана; 8 — ближе к домашней полосе, но не на ней.
 * Сдвигает локальный плагин TabBarOffset (MainViewController.swift).
 */
const NATIVE_BAR_DROP_PT = 8;
const TabBarOffset = registerPlugin<{ apply(o: { y: number }): Promise<void> }>('TabBarOffset');

/**
 * Вкладки системной панели. Символы — SF Symbols в залитом варианте:
 * в панели вкладок iOS залиты все значки, выбранная отличается цветом
 * (HIG, Tab bars). Подписи — те же, что у веб-панели.
 */
const NATIVE_TABS: { id: TabId; title: string; systemImage: string }[] = [
  { id: 'quran', title: 'Коран', systemImage: 'book.fill' },
  { id: 'azkar', title: 'Азкары', systemImage: 'moon.fill' },
];

/**
 * Цвет выбранной вкладки. 🔴 Держать равным `--brand` в src/index.css
 * (светлые темы / тёмные). Плагин принимает только #RRGGBB, а CSS-переменную
 * с нативной стороны не прочитать.
 */
export const BRAND_HEX = { light: '#7c6340', dark: '#dcc5a3' } as const;

/** Геометрия веб-капсулы: высота содержимого, зазор и подрезка зоны. */
export const WEB_BAR = {
  /** Высота самой капсулы. */
  height: 62,
  /** Зазор, который экраны добавляют к капсуле в своём нижнем отступе. */
  inset: 10,
  /** Нижняя координата капсулы. */
  bottom: 'max(6px, calc(env(safe-area-inset-bottom) - 18px))',
} as const;

// Состояние показа — см. «Показ и скрытие» ниже.
let wanted = false;
let shown = false;
let launchDone = false;
let running = false;
let pumpTimer = 0;
/** Кэш tabBarTopPx(). Объявлен до первого applyGeometry(): иначе TDZ. */
let cachedTop: number | null = null;
/** Сколько открыто шторок, под которыми панель прятать (см. suppress…). */
let suppressed = 0;

let mode: TabBarMode = Capacitor.getPlatform() === 'ios' ? 'pending' : 'web';
const listeners = new Set<() => void>();

function applyGeometry(): void {
  invalidateTop();
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  if (mode === 'native') {
    root.setProperty('--tabbar-space', '0px');
    root.setProperty('--tabbar-top', 'env(safe-area-inset-bottom)');
  } else {
    root.setProperty('--tabbar-space', `${WEB_BAR.height + WEB_BAR.inset}px`);
    root.setProperty('--tabbar-top', `calc(${WEB_BAR.bottom} + ${WEB_BAR.height}px)`);
  }
}
applyGeometry();

function setMode(next: TabBarMode): void {
  if (mode === next) return;
  mode = next;
  applyGeometry();
  listeners.forEach(fn => fn());
  // Ушли в веб-режим после сбоя — нативную панель, если она успела
  // показаться, убираем, иначе внизу оказались бы две панели.
  if (next === 'web' && shown) {
    shown = false;
    void NativeBar.hide().catch(() => undefined);
  }
}

export function getTabBarMode(): TabBarMode {
  return mode;
}

export function subscribeTabBarMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ── Выбор вкладки ──────────────────────────────────────────────────────

let onSelect: ((id: TabId) => void) | null = null;

/** Кто обрабатывает тап по системной панели (ставит веб-компонент TabBar). */
export function setNativeTabSelectHandler(fn: ((id: TabId) => void) | null): void {
  onSelect = fn;
}

let started = false;

/**
 * Выяснить режим и подготовить системную панель. Вызывается один раз при
 * старте; любой сбой (нет плагина, неизвестный символ, старая iOS) — это
 * веб-панель, а не пустой низ экрана.
 */
export async function initNativeTabBar(): Promise<void> {
  if (started || mode !== 'pending') return;
  started = true;
  try {
    if (!Capacitor.isPluginAvailable('TabBar')) throw new Error('TabBar plugin missing');
    const { osVersion } = await Device.getInfo();
    const major = Number.parseInt(osVersion, 10);
    if (!(major >= MIN_IOS_MAJOR)) {
      setMode('web');
      return;
    }
    await NativeBar.setTabs({ tabs: NATIVE_TABS, selectedTabId: 'quran' });
    await NativeBar.addListener('tabSelected', event => {
      onSelect?.(event.id as TabId);
    });
    setMode('native');
    schedulePump();
  } catch {
    setMode('web');
  }
}

/** Отметить вкладку выбранной (событие tabSelected при этом не приходит). */
export function selectNativeTab(id: TabId): void {
  if (mode !== 'native') return;
  void NativeBar.selectTabById({ id }).catch(() => undefined);
}

let lastTint = '';
/** Цвет выбранной вкладки под тему приложения. */
export function tintNativeTabBar(theme: Theme): void {
  if (mode !== 'native') return;
  const hex = themeMode(theme) === 'light' ? BRAND_HEX.light : BRAND_HEX.dark;
  if (hex === lastTint) return;
  lastTint = hex;
  void NativeBar.setColors({ selectedColor: hex }).catch(() => { lastTint = ''; });
}

// ── Показ и скрытие ────────────────────────────────────────────────────
//
// Смена вкладки пересоздаёт экран (Shell с key), и веб-компонент панели
// успевает размонтироваться и смонтироваться в одном коммите React:
// «скрыть» и сразу «показать». Выполнять их по очереди значит мигнуть
// панелью. Поэтому желаемое состояние копится, а мост вызывается в
// следующей задаче и только если желаемое расходится с показанным.

function schedulePump(): void {
  if (pumpTimer) return;
  // setTimeout, а не rAF: в скрытой вкладке rAF не тикает (CLAUDE.md,
  // грабли № 5).
  pumpTimer = window.setTimeout(() => {
    pumpTimer = 0;
    void pump();
  }, 0);
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (mode === 'native' && effectiveWanted() !== shown) {
      const target = effectiveWanted();
      // Над заставкой системная панель легла бы поверх неё — ждём начала
      // растворения (markLaunchFaded).
      if (target && !launchDone) break;
      await (target ? NativeBar.show() : NativeBar.hide());
      shown = target;
      invalidateTop();
      // Сдвиг ставится на каждый показ: панель — тот же объект, но так не
      // зависит от того, сохранил ли плагин его между показами. Старая
      // сборка без плагина ответит отказом — панель тогда на штатном месте.
      if (target) void TabBarOffset.apply({ y: NATIVE_BAR_DROP_PT }).catch(() => undefined);
    }
  } catch {
    setMode('web');
  } finally {
    running = false;
  }
}

/** Показывать ли панель сейчас: экран с ней открыт и шторок над ним нет. */
function effectiveWanted(): boolean {
  return wanted && suppressed === 0;
}

/**
 * Спрятать системную панель, пока открыта нижняя шторка; вернуть — вызвать
 * отданную функцию. Системная панель лежит в UIKit НАД веб-вью: шторка
 * (SettingsSheet) оказалась бы под стеклом панели, а её подложка панель не
 * затемнила бы, и тап по вкладке переключал бы раздел под открытой
 * шторкой. Модальная шторка iOS панель накрывает — здесь панель уходит.
 */
export function suppressNativeTabBar(): () => void {
  suppressed += 1;
  schedulePump();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suppressed -= 1;
    schedulePump();
  };
}

/** Экран с панелью появился (true) или ушёл (false). */
export function setNativeTabBarVisible(visible: boolean): void {
  wanted = visible;
  schedulePump();
}

/** Заставка начала растворяться — системной панели можно появляться. */
export function markLaunchFaded(): void {
  if (launchDone) return;
  launchDone = true;
  schedulePump();
}

/**
 * Высота от низа экрана до верхней кромки панели, в пикселях — для кода,
 * которому нужно число, а не CSS (зона быстрой прокрутки). Меряется
 * пробным элементом, потому что env() из JS не прочитать. У веб-капсулы
 * замер кэшируется до смены режима или размера окна: его просят на каждое
 * касание списка.
 */
function invalidateTop(): void { cachedTop = null; }
if (typeof window !== 'undefined') window.addEventListener('resize', invalidateTop);

export function tabBarTopPx(): number {
  // У системной панели не кэшируем: новая безопасная зона доезжает до
  // WebKit позже ответа show(), без события resize, и кэш застрял бы на
  // значении без панели. Замер один на касание — дёшево.
  if (cachedTop !== null && mode !== 'native') return cachedTop;
  if (typeof document === 'undefined') return WEB_BAR.height + WEB_BAR.inset;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;'
    + 'height:var(--tabbar-top)';
  document.body.appendChild(probe);
  cachedTop = probe.getBoundingClientRect().height;
  probe.remove();
  return cachedTop;
}
