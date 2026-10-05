/**
 * TabPager — корневые вкладки и горизонтальный свайп между ними.
 *
 * ── Что делает ────────────────────────────────────────────────────────
 *
 * Владелец 2026-10-04: листать вкладки свайпом, как страницы в iOS (с
 * 2026-10-05 их три: «Плеер» | «Коран» | «Азкары», листаются по порядку). Палец ведёт страницу один к одному, соседняя выезжает рядом;
 * отпускание доводит до ближайшей вкладки (дальше 35 % ширины или быстрым
 * взмахом — перелистнуть, иначе вернуть). За крайней вкладкой — резинка.
 * Перелистывание идёт тем же путём, что тап по вкладке (`onSwipe` = тот же
 * обработчик, что у TabBar), поэтому история, позиция прокрутки и обе
 * панели вкладок — веб-капсула и системная iOS 26 — переключаются сами.
 * При «Уменьшении движения» страница за пальцем не едет: жест только
 * меняет вкладку.
 *
 * ── Все вкладки живут в DOM ──────────────────────────────────────────
 *
 * Чтобы соседняя страница появлялась под пальцем мгновенно, её нельзя
 * монтировать в начале жеста: список из 114 сур раскладывается ~100 мс, и
 * свайп начинался бы с рывка. Поэтому неактивная вкладка не
 * размонтируется, а в покое лежит отдельным слоем во весь экран
 * (`position: fixed`, скрыта, без касаний, `inert`) — так она не тянет
 * высоту документа. Её раскладка поддерживается в актуальном виде, и на
 * свайпе остаётся сделать её видимым листом рядом с текущей и сдвинуть
 * (листы на время жеста — gesturePageStyle). Заодно возврат на вкладку тапом стал без
 * повторного монтирования. Вкладку, где человек ещё не был, монтируем
 * через `PREMOUNT_MS` после старта — к первому свайпу она готова.
 *
 * ── Как едут страницы ─────────────────────────────────────────────────
 *
 * На время жеста страницы — листы размером с окно, сдвигаемые transform
 * (подробно и с историей попыток — у gesturePageStyle). Шапка каждой
 * вкладки едет вместе со своим листом. Мини-плеер, нижняя панель и
 * размытие под ней лежат вне страниц и стоят на месте; мини-плеер, которого
 * нет на вкладке «Плеер», плавно гаснет или проявляется по ходу жеста
 * (`data-tab-chrome`).
 *
 * ── Чего жест не трогает ──────────────────────────────────────────────
 *
 *  • касания у левого края (`SWIPE_EDGE_GUARD_PX`) — системный «назад»;
 *  • полосу быстрой прокрутки списка сур (FastScrubber.isScrubStripStart);
 *  • поля ввода и открытую клавиатуру;
 *  • области, которые сами листаются вбок (лента «Продолжить чтение»);
 *  • открытые шторки (`[data-reading-sheet]`), меню и диалоги;
 *  • экраны «поверх» вкладок: там App выключает пейджер (`enabled`).
 *
 * Во время жеста React не участвует — положение пишется прямо в style, как
 * в IosEdgeBackGesture: перерисовка дерева на каждом кадре пальца давала
 * бы рывки на тяжёлом списке.
 */

import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import type { TabId } from './TabBar';
import { isScrubStripStart } from './FastScrubber';
import {
  SWIPE_EASING,
  SWIPE_EDGE_GUARD_PX,
  SWIPE_SETTLE_MS,
  dragOffset,
  lockAxis,
  releaseTarget,
  velocityOf,
  type SwipeSample,
} from '../lib/tabSwipe';

/** Через сколько после старта монтировать вкладки, где ещё не были, мс. */
const PREMOUNT_MS = 1500;
/** Страховка: вкладка так и не сменилась после перелистывания, мс. */
const COMMIT_GUARD_MS = 600;
/**
 * Сколько ждать клика, порождённого отпусканием после жеста, мс. Как у
 * быстрой прокрутки (FastScrubber): гасим ровно один такой клик, а не все
 * подряд по таймеру — быстрый законный тап следом должен сработать.
 */
const SWALLOW_CLICK_MS = 400;

/** Активная вкладка — в потоке документа: окно прокручивает её. */
const ACTIVE_STYLE = { position: 'relative' } as const;
/**
 * Неактивная — слой во весь экран, унесённый за левый край (`transform`), и
 * `inert` (App ставит его в разметке). Не `display: none`: раскладка
 * сохраняется, и показать слой на свайпе — это перерисовка, а не раскладка
 * 114 строк заново. За кадром браузер его не рисует, и касаний он не ловит.
 *
 * 🔴 Не `visibility: hidden` + `pointer-events: none`, как было до
 * 2026-10-05. Оба свойства наследуемые, и Blink переносит их смену на
 * потомков упрощённым путём; после серии жестов и тапов (тап по вкладке
 * посреди довода, потом обратно) у части потомков застревало старое
 * значение: страница «Азкаров» видна, а плитки внутри — `hidden`, тап по
 * ним не открывал категорию (воспроизводилось в headless Chromium через раз).
 * `transform` не наследуется — застревать нечему, а смена не пересчитывает
 * стили тысяч узлов страницы.
 *
 * Значения строками (`'0px'`, а не 0): этот же объект жест пишет в style
 * руками, возвращая страницу в покой, и значения обязаны совпасть с теми,
 * что поставил React, — иначе его следующая сверка стилей разошлась бы с DOM.
 */
const PARKED_STYLE = {
  position: 'fixed',
  top: '0px',
  left: '0px',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  transform: 'translateX(-200%)',
} as const;
type PageStyleKey = keyof typeof PARKED_STYLE;
const PAGE_STYLE_KEYS = Object.keys(PARKED_STYLE) as PageStyleKey[];

/** Записать в style свойства страницы (имена — как в React). */
function writePageStyle(el: HTMLElement, values: Partial<Record<PageStyleKey, string>>): void {
  for (const key of PAGE_STYLE_KEYS) {
    const value = values[key];
    if (value === undefined) continue;
    el.style.setProperty(key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), value);
  }
}

/** Вернуть странице ровно те стили, что задаёт ей React в покое. */
function restPage(el: HTMLElement, isActive: boolean): void {
  const values: Partial<Record<PageStyleKey, string>> = {};
  for (const key of PAGE_STYLE_KEYS) {
    values[key] = isActive ? ((ACTIVE_STYLE as Partial<Record<PageStyleKey, string>>)[key] ?? '') : PARKED_STYLE[key];
  }
  writePageStyle(el, values);
  el.style.willChange = '';
  el.style.transition = '';
}

/**
 * Страница на время жеста — лист размером с окно в координатах документа
 * (`position: absolute` ровно там, где сейчас окно, `overflow: hidden`),
 * который двигается `transform`. Содержимое внутри листа сдвинуто на
 * прокрутку этой вкладки (`PAGE_BODY`), поэтому в листе видно ровно то, что
 * человек видел в окне.
 *
 * 🔴 Почему так, а не иначе (владелец 2026-10-05, скриншоты с iPhone: на
 * свайпе «Азкары появляются поверх, дёргается, размытие снизу появляется
 * только потом, капсула шапки срезана краем страницы»). Перепробовано:
 *  • fixed-слой во весь экран, сдвиг `left` (до 2026-10-05). WebKit
 *    обрезает закреплённую шапку краем закреплённого родителя с
 *    `overflow: hidden` — капсулу «Корана» срезало краем уезжающей
 *    страницы; страницы-слои жили вне прокручиваемого документа, и нижняя
 *    кромка под панелью (`.tabbar-edge`, размытие фона) на iPhone их не
 *    размывала, пока страница не возвращалась в поток;
 *  • абсолютная страница во всю высоту, сдвиг `left` — Chromium
 *    перерисовывает весь её текст на каждом кадре (замер ×4 CPU: задачи по
 *    50–70 мс всё время свайпа).
 * Transform у листа — сдвиг готового слоя на композиторе, без перерисовки, в
 * любом движке; лист — часть документа, как страница в покое.
 *
 * Цена: transform делает лист опорой для закреплённой шапки вкладки, и
 * шапка едет вместе со своей страницей, а не стоит на месте. Это и есть
 * лист целиком, как экран в навигации iOS: у каждой вкладки свой заголовок
 * и свои кнопки, и они уходят вместе с ней — без перетекания одной шапки в
 * другую, на котором и были вспышки размытия.
 */
function gesturePageStyle(top: number, height: number): Partial<Record<PageStyleKey, string>> {
  return {
    position: 'absolute',
    top: `${top}px`,
    left: '0px',
    width: '100%',
    height: `${height}px`,
    overflow: 'hidden',
  };
}

/** Внутренний слой страницы: на время жеста ему ставится сдвиг прокрутки. */
const PAGE_BODY = { position: 'relative' } as const;

type Fadable = HTMLElement | SVGElement;

/** Цели, с которых жест не начинается: там палец занят своим делом. */
const BLOCKED_TARGET = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
/** Открыто что-то модальное — листать вкладки под ним нельзя. */
const OPEN_OVERLAY = '[data-reading-sheet], [role="menu"], [role="dialog"], [aria-modal="true"]';

type Drag = {
  phase: 'pending' | 'dragging';
  startX: number;
  startY: number;
  /** Где палец был в момент выбора направления: от неё страница едет 1:1. */
  originX: number;
  width: number;
  /** Индекс активной вкладки на момент касания. */
  index: number;
  offset: number;
  samples: SwipeSample[];
  /** Слои подготовлены (при «Уменьшении движения» — нет). */
  layered: boolean;
};

/**
 * Гаснущая часть шапки или панели: что вернуть после жеста (`opacity`,
 * `transition` из инлайна) и собственная прозрачность в покое (`base`) — у
 * компактного заголовка и кромки она своя, по прокрутке.
 */
type Faded = { el: Fadable; opacity: string; transition: string; base: number };

function rememberFade(el: Fadable): Faded {
  const base = parseFloat(getComputedStyle(el).opacity);
  return { el, opacity: el.style.opacity, transition: el.style.transition, base: Number.isFinite(base) ? base : 1 };
}

/**
 * Панель, видимая не на всех вкладках (мини-плеер скрыт на вкладке
 * «Плеер»). Обёртка с `data-tab-chrome="id id"` — список вкладок, где она
 * видна; на остальных App ставит обёртке `data-chrome-off`, и правило в
 * index.css гасит её детей (прозрачность и касания — у самой панели: не
 * `visibility` у обёртки, см. PARKED_STYLE про наследуемые свойства). На
 * свайпе между
 * вкладкой «с ней» и «без неё» панель не мелькает в момент смены, а гаснет
 * или проявляется вместе с перелистыванием.
 */
type Chrome = {
  wrapper: HTMLElement;
  shownOn: readonly string[];
  kids: Faded[];
};

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Внутри элемента, который сам прокручивается по горизонтали. */
function inHorizontalScroller(target: Element, root: Element): boolean {
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const overflowX = getComputedStyle(el).overflowX;
    if (overflowX === 'auto' || overflowX === 'scroll') return true;
  }
  return false;
}

export function TabPager({
  order,
  active,
  enabled,
  scrollOf,
  onSwipe,
  renderTab,
  fallback,
}: {
  /** Порядок вкладок — как в нижней панели, слева направо. */
  order: readonly TabId[];
  active: TabId;
  /** false — вкладки под экраном «поверх»: жест выключен. */
  enabled: boolean;
  /** Сохранённая прокрутка вкладки (App, tabScrollRef). */
  scrollOf: (id: TabId) => number;
  /** Перелистнули свайпом — тот же путь, что тап по вкладке. */
  onSwipe: (id: TabId) => void;
  renderTab: (id: TabId, isActive: boolean) => ReactNode;
  /** Заглушка на время подгрузки чанка экрана. */
  fallback: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Partial<Record<TabId, HTMLDivElement | null>>>({});
  const bodyRefs = useRef<Partial<Record<TabId, HTMLDivElement | null>>>({});
  // Каждая вкладка, однажды смонтированная, остаётся в DOM. Активная
  // монтируется сразу, в том же рендере, — без пустого кадра на тапе.
  const [mounted, setMounted] = useState<ReadonlySet<TabId>>(() => new Set([active]));

  // Свежие значения пропсов — в ref: слушатели касаний вешаются один раз.
  const live = useRef({ order, active, scrollOf, onSwipe });
  live.current = { order, active, scrollOf, onSwipe };

  const dragRef = useRef<Drag | null>(null);
  /** Довод после отпускания или ожидание смены вкладки — новый жест ждёт. */
  const busyRef = useRef<'idle' | 'settling' | 'committing'>('idle');
  const timerRef = useRef(0);
  const frameRef = useRef(0);
  // Остановка жеста нужна и эффекту касаний, и эффекту смены вкладки —
  // держим одну реализацию в ref, чтобы оба вызывали одно и то же.
  const stopRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (mounted.has(active)) return;
    setMounted(prev => new Set([...prev, active]));
  }, [active, mounted]);

  useEffect(() => {
    // setTimeout, а не rAF/idle: в WKWebView нет requestIdleCallback, а rAF
    // не тикает в скрытой вкладке (CLAUDE.md, грабли № 5).
    const id = window.setTimeout(() => {
      setMounted(prev => (prev.size === live.current.order.length ? prev : new Set(live.current.order)));
    }, PREMOUNT_MS);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;

    const page = (id: TabId | undefined) => (id ? pageRefs.current[id] ?? null : null);
    const body = (id: TabId | undefined) => (id ? bodyRefs.current[id] ?? null : null);
    /** Панели с `data-tab-chrome` на время жеста (см. тип Chrome). */
    let chrome: Chrome[] = [];

    const clearTimer = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = 0;
    };

    /**
     * Снять незавершённый довод: слушатель `transitionend` и его колбэк.
     * Без этого довод, перебитый тапом по вкладке или выключением пейджера,
     * оставался бы подписан на страницу, и следующий же переход `transform` на
     * ней (короткий свайп с возвратом) вызвал бы старый колбэк — например,
     * перелистывание, которого никто уже не просил.
     */
    let cancelSettle: (() => void) | null = null;
    const stopSettle = () => {
      const cancel = cancelSettle;
      cancelSettle = null;
      cancel?.();
    };

    /**
     * Прокрутка окна на время довода и смены вкладки запрещена: под
     * закреплёнными слоями она сдвинула бы `scrollY`, и после сброса список
     * прыгнул бы, а App запомнил бы неверную позицию уходящей вкладки.
     * Слушатели на окне — только на эти ~300 мс: постоянный неpassive
     * touchmove на окне замедлял бы любую прокрутку.
     */
    const blockScroll = (event: Event) => { if (event.cancelable) event.preventDefault(); };
    let scrollLocked = false;
    const lockScroll = (on: boolean) => {
      if (on === scrollLocked) return;
      scrollLocked = on;
      if (on) {
        window.addEventListener('touchmove', blockScroll, { passive: false });
        window.addEventListener('wheel', blockScroll, { passive: false });
      } else {
        window.removeEventListener('touchmove', blockScroll);
        window.removeEventListener('wheel', blockScroll);
      }
    };

    /**
     * Состояние пейджера. Пока страницы доводятся и вкладка меняется,
     * клики по ним не принимаются (тап по уезжающей строке открыл бы суру
     * с чужой вкладки — гасит onClickCapture) и окно не прокручивается.
     *
     * Не `pointer-events: none` на корне, как было: свойство наследуемое, и
     * его смена пересчитывала стили всех тысяч узлов обеих страниц ровно в
     * кадре отпускания (замер Chromium ×4: задача ~150 мс в начале довода).
     */
    const setBusy = (next: 'idle' | 'settling' | 'committing') => {
      busyRef.current = next;
      lockScroll(next !== 'idle');
    };

    /**
     * Клик после жеста. Если палец сдвинул плитку или строку и вернул её на
     * место, браузер всё равно может прислать клик по ней — и открылась бы
     * категория азкаров или сура, хотя человек листал. Гасим один клик на
     * погружении: остановка распространения не даёт ему дойти до
     * обработчика React на корне приложения.
     */
    let swallowClick = false;
    let swallowTimer = 0;
    const armClickSwallow = () => {
      swallowClick = true;
      if (swallowTimer) window.clearTimeout(swallowTimer);
      swallowTimer = window.setTimeout(() => { swallowClick = false; swallowTimer = 0; }, SWALLOW_CLICK_MS);
    };
    const onClickCapture = (event: MouseEvent) => {
      const busy = busyRef.current !== 'idle';
      if (!swallowClick && !busy) return;
      if (swallowClick) swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const cancelFrame = () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };

    /** Соседи активной вкладки: слева и справа в порядке панели. */
    const neighbours = (index: number) => {
      const { order: tabs } = live.current;
      return { prev: tabs[index - 1], next: tabs[index + 1] };
    };

    /**
     * Подготовить слои один раз за жест: текущую и соседние страницы — в
     * листы размером с окно (см. gesturePageStyle). Корню остаётся прежняя
     * высота документа, поэтому окно не съезжает, а кадр не меняется: лист
     * текущей страницы стоит там же, где окно, и показывает то же место.
     */
    const openLayers = (drag: Drag) => {
      const { order: tabs, scrollOf: scrollOfTab } = live.current;
      const currentId = tabs[drag.index];
      const current = page(currentId);
      if (!current) return;
      const rootTop = root.getBoundingClientRect().top + window.scrollY;
      // Верх окна в координатах корня — туда встают все листы.
      const viewportTop = window.scrollY - rootTop;
      const height = window.innerHeight;
      root.style.minHeight = `${current.offsetHeight}px`;
      const sheet = (id: TabId, el: HTMLElement, scroll: number) => {
        writePageStyle(el, gesturePageStyle(viewportTop, height));
        el.style.willChange = 'transform';
        const inner = body(id);
        if (inner) inner.style.top = `${-scroll}px`;
      };
      sheet(currentId, current, viewportTop);
      const { prev, next } = neighbours(drag.index);
      for (const id of [prev, next]) {
        const el = page(id);
        // Соседняя страница показывается там, где человек её оставил.
        if (id && el) sheet(id, el, scrollOfTab(id) - rootTop);
      }
      // Панели вне страниц, видимые не на всех вкладках, — рядом с корнем
      // пейджера (App кладёт их в тот же экран).
      const scope = root.parentElement ?? document.body;
      chrome = Array.from(scope.querySelectorAll<HTMLElement>('[data-tab-chrome]')).map(wrapper => {
        const shownOn = (wrapper.dataset.tabChrome ?? '').split(/\s+/).filter(Boolean);
        // Погашенная правилом панель (`data-chrome-off`) своей прозрачности
        // не показывает — в видимом виде она непрозрачна.
        const off = wrapper.hasAttribute('data-chrome-off');
        const kids = Array.from(wrapper.children)
          .filter((el): el is HTMLElement => el instanceof HTMLElement)
          .map(el => (off ? { ...rememberFade(el), base: 1 } : rememberFade(el)));
        return { wrapper, shownOn, kids };
      });
      drag.layered = true;
      // Первый кадр — сразу, а не в следующем rAF: иначе в кадре между
      // «сосед стал видимым» и первым сдвигом он стоял бы поверх текущей
      // (замер до 2026-10-05: один кадр с обеими шапками целиком).
      paint(drag, 0);
    };

    /** Положение кадра: только transform листов и прозрачность панелей. */
    const paint = (drag: Drag, offset: number) => {
      const { order: tabs } = live.current;
      const { prev, next } = neighbours(drag.index);
      const w = drag.width;
      const move = (el: HTMLElement | null, x: number) => {
        if (el) el.style.transform = `translate3d(${x}px, 0, 0)`;
      };
      const prevEl = page(prev);
      const nextEl = page(next);
      move(page(tabs[drag.index]), offset);
      move(prevEl, offset - w);
      move(nextEl, offset + w);
      // Панели «не на всех вкладках» перетекают в сторону, где есть сосед.
      const progress = Math.min(1, Math.abs(offset) / Math.max(1, w));
      const towardId = offset < 0 && nextEl ? next : offset > 0 && prevEl ? prev : undefined;
      const currentId = tabs[drag.index];
      for (const { shownOn, kids } of chrome) {
        const from = shownOn.includes(currentId) ? 1 : 0;
        const to = towardId ? (shownOn.includes(towardId) ? 1 : 0) : from;
        const factor = from + (to - from) * progress;
        for (const { el, base } of kids) el.style.opacity = String(base * factor);
      }
    };

    const setTransition = (drag: Drag, on: boolean) => {
      const { order: tabs } = live.current;
      const { prev, next } = neighbours(drag.index);
      const move = on ? `transform ${SWIPE_SETTLE_MS}ms ${SWIPE_EASING}` : 'none';
      const fade = on ? `opacity ${SWIPE_SETTLE_MS}ms ${SWIPE_EASING}` : 'none';
      for (const id of [tabs[drag.index], prev, next]) {
        const el = page(id);
        if (el) el.style.transition = move;
      }
      for (const { kids } of chrome) {
        for (const { el } of kids) el.style.transition = fade;
      }
    };

    /**
     * Вернуть страницы в покой — ровно в те значения, что задаёт React
     * для текущей активной вкладки. Зовётся и после возврата, и после
     * перелистывания (тогда React уже переставил стили страниц, и сброс
     * лишь совпадает с ними).
     */
    const resetLayers = () => {
      cancelFrame();
      stopSettle();
      const { order: tabs, active: activeTab } = live.current;
      for (const id of tabs) {
        const el = page(id);
        if (el) restPage(el, id === activeTab);
        const inner = body(id);
        if (inner) inner.style.top = '';
      }
      // Высота документа снова держится страницей в потоке. Прокрутку
      // ставит App (восстановление позиции вкладки) — после этого сброса,
      // в том же кадре.
      root.style.minHeight = '';
      // Инлайн долой — видимостью снова правит `data-chrome-off` от React.
      for (const { kids } of chrome) {
        for (const { el, opacity, transition } of kids) {
          el.style.opacity = opacity;
          el.style.transition = transition;
        }
      }
      chrome = [];
    };

    /** Остановить всё: довод, страховку, жест — и вернуть страницы в покой. */
    const stopAll = () => {
      dragRef.current = null;
      clearTimer();
      setBusy('idle');
      resetLayers();
    };
    stopRef.current = stopAll;

    /** Довести страницы до `target` и позвать `done` один раз. */
    const settle = (drag: Drag, target: number, done: () => void) => {
      cancelFrame();
      clearTimer();
      stopSettle();
      setBusy('settling');
      const current = page(live.current.order[drag.index]);
      let finished = false;
      const detach = () => {
        finished = true;
        clearTimer();
        current?.removeEventListener('transitionend', onEnd);
        if (cancelSettle === detach) cancelSettle = null;
      };
      const finish = () => {
        if (finished) return;
        detach();
        done();
      };
      const onEnd = (event: TransitionEvent) => {
        if (event.target === current && event.propertyName === 'transform') finish();
      };
      current?.addEventListener('transitionend', onEnd);
      cancelSettle = detach;
      setTransition(drag, true);
      paint(drag, target);
      // transitionend может не прийти (сдвиг уже был нулевым, WebView
      // потерял кадр). Резерв — чуть позже CSS-перехода, на setTimeout:
      // rAF не тикает в свёрнутом WebView.
      timerRef.current = window.setTimeout(finish, SWIPE_SETTLE_MS + 80);
    };

    const haptic = () => {
      // Лёгкий отклик — как на тапе по вкладке веб-капсулы (TabBar,
      // useTabTap): impact, а не selectionChanged, тот на iOS молчит.
      if (Capacitor.getPlatform() === 'ios') void Haptics.impact({ style: ImpactStyle.Light });
    };

    /** Перелистнули: сменить вкладку тем же путём, что тап. */
    const commit = (id: TabId) => {
      setBusy('committing');
      live.current.onSwipe(id);
      // Если вкладка не сменилась (переход отклонён), страницы не должны
      // остаться сдвинутыми.
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        if (busyRef.current !== 'committing') return;
        stopAll();
      }, COMMIT_GUARD_MS);
    };

    /** Жест прерван (второй палец, системный жест): вернуть на место. */
    const abort = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.phase !== 'dragging' || !drag.layered) return;
      settle(drag, 0, stopAll);
    };

    const blocked = (event: TouchEvent, x: number): boolean => {
      if (x < SWIPE_EDGE_GUARD_PX) return true;
      if (isScrubStripStart(event)) return true;
      if (document.querySelector(OPEN_OVERLAY)) return true;
      // Открыта клавиатура — сначала её закрывают, листать под ней нельзя:
      // фокус остался бы в поле на ушедшей вкладке.
      const focused = document.activeElement;
      if (focused instanceof Element && focused.matches(BLOCKED_TARGET)) return true;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return false;
      if (target.closest(BLOCKED_TARGET)) return true;
      return inHorizontalScroller(target, root);
    };

    const onTouchStart = (event: TouchEvent) => {
      // Новое касание — уже другой жест: клик прошлого отпускания не пришёл,
      // и гасить следующий, законный, нельзя.
      swallowClick = false;
      if (busyRef.current !== 'idle') return;
      if (event.touches.length !== 1) {
        abort();
        return;
      }
      const touch = event.touches[0];
      const index = live.current.order.indexOf(live.current.active);
      if (index < 0 || blocked(event, touch.clientX)) {
        dragRef.current = null;
        return;
      }
      dragRef.current = {
        phase: 'pending',
        startX: touch.clientX,
        startY: touch.clientY,
        originX: touch.clientX,
        // Ширину снимаем раз за жест: чтение на каждом кадре заставляло бы
        // WebKit считать раскладку.
        width: window.innerWidth,
        index,
        offset: 0,
        samples: [],
        layered: false,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (event.touches.length !== 1) {
        abort();
        return;
      }
      const touch = event.touches[0];
      if (drag.phase === 'pending') {
        const axis = lockAxis(touch.clientX - drag.startX, touch.clientY - drag.startY);
        if (axis === null) return;
        if (axis === 'vertical') {
          // Прокрутка списка — не наш жест до самого отпускания.
          dragRef.current = null;
          return;
        }
        drag.phase = 'dragging';
        // От точки выбора направления, а не от касания: иначе страница
        // прыгнула бы на порог распознавания. Так же ведёт себя UIScrollView.
        drag.originX = touch.clientX;
        const { order: tabs } = live.current;
        // Соседа ещё нет в DOM (вкладку не посещали, а предмонтаж не
        // успел) — монтируем сейчас; до готовности на его месте заглушка.
        setMounted(prev => (prev.size === tabs.length ? prev : new Set(tabs)));
        if (!prefersReducedMotion()) openLayers(drag);
      }
      if (drag.phase !== 'dragging') return;
      // Горизонтальный жест — наш: страница под пальцем не прокручивается.
      if (event.cancelable) event.preventDefault();
      const now = event.timeStamp || performance.now();
      drag.samples.push({ t: now, x: touch.clientX });
      if (drag.samples.length > 12) drag.samples.shift();
      const { prev, next } = neighbours(drag.index);
      drag.offset = dragOffset(touch.clientX - drag.originX, drag.width, !!prev, !!next);
      if (!drag.layered) return;
      // touchmove бывает чаще частоты экрана: одно обновление на кадр.
      if (!frameRef.current) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = 0;
          const ongoing = dragRef.current;
          if (ongoing && ongoing.layered) paint(ongoing, ongoing.offset);
        });
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (drag.phase !== 'dragging') return;
      armClickSwallow();
      // Отпускание — последняя точка для скорости (см. velocityOf).
      const touch = event.changedTouches[0];
      if (touch) drag.samples.push({ t: event.timeStamp || performance.now(), x: touch.clientX });
      const { prev, next } = neighbours(drag.index);
      const step = releaseTarget({
        offset: drag.offset,
        velocity: velocityOf(drag.samples),
        width: drag.width,
        hasPrev: !!prev,
        hasNext: !!next,
      });
      const target = step === 1 ? next : step === -1 ? prev : undefined;

      if (!drag.layered) {
        // «Уменьшение движения»: страница не ехала — только смена вкладки.
        if (target) {
          haptic();
          commit(target);
        }
        return;
      }
      if (!target) {
        settle(drag, 0, stopAll);
        return;
      }
      // Отклик — в момент решения, а не после довода: так он совпадает с
      // отпусканием пальца, как у системных переключателей.
      haptic();
      settle(drag, step === 1 ? -drag.width : drag.width, () => commit(target));
    };

    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    root.addEventListener('touchcancel', abort, { passive: true });
    root.addEventListener('click', onClickCapture, { capture: true });
    return () => {
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('touchcancel', abort);
      root.removeEventListener('click', onClickCapture, { capture: true } as EventListenerOptions);
      if (swallowTimer) window.clearTimeout(swallowTimer);
      // Пейджер выключили посреди жеста (открылся экран «поверх»): страницы
      // в покой, иначе соседняя осталась бы видимым слоем.
      stopAll();
    };
  }, [enabled]);

  // Смена вкладки. После свайпа — снять слои в том же кадре, где React
  // переставил страницы (до отрисовки), иначе мелькнёт промежуточное
  // положение.
  //
  // 🔴 После тапа страница сменяется мгновенно, без проявления — как
  // вкладки в iOS (lib/navTransition.ts: «смена вкладки мгновенная»). До
  // 2026-10-05 здесь было проявление 150 мс (Web Animations на частях
  // страницы), и его пришлось снять: если вкладку меняли, пока оно шло
  // (тап, через 150 мс другой тап), Blink у анимируемых элементов терял
  // наследуемое изменение `inert`, и плитки «Азкаров» переставали
  // нажиматься (headless Chromium: 3–4 прогона из 8 с проявлением, даже с
  // его отменой; 0 из 6 без него).
  const lastActiveRef = useRef(active);
  useLayoutEffect(() => {
    if (lastActiveRef.current === active) return;
    lastActiveRef.current = active;
    if (busyRef.current !== 'idle' || dragRef.current) stopRef.current();
  }, [active]);

  return (
    <div
      ref={rootRef}
      data-tab-pager=""
      style={{
        position: 'relative',
        // Вертикальную прокрутку отдаём браузеру целиком, горизонталь —
        // жесту. Ленту «Продолжить чтение» это не задевает: у неё своя
        // прокрутка, и touch-action предков выше неё не учитывается.
        touchAction: enabled ? 'pan-y' : undefined,
      }}
    >
      {order.map(id => {
        const isActive = id === active;
        return (
          <div
            key={id}
            ref={el => { pageRefs.current[id] = el; }}
            data-tab-page={id}
            // Признак для App: клон экрана для жеста «назад» снимается без
            // скрытой вкладки, иначе её шапка всплыла бы в предпросмотре.
            data-tab-parked={isActive ? undefined : ''}
            aria-hidden={isActive ? undefined : true}
            // inert: скрытая вкладка не ловит фокус и касания. React 18
            // атрибута не знает — пустой строкой (см. Shell в App.tsx). 🔴
            // На React 19 заменить на `inert={!isActive}`.
            {...(isActive ? {} : { inert: '' })}
            style={isActive ? ACTIVE_STYLE : PARKED_STYLE}
          >
            <div ref={el => { bodyRefs.current[id] = el; }} style={PAGE_BODY}>
              {(isActive || mounted.has(id)) && (
                // Своя граница на каждую вкладку: подгрузка чанка скрытой
                // вкладки не должна подменять заглушкой видимую.
                <Suspense fallback={fallback}>
                  {renderTab(id, isActive)}
                </Suspense>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
