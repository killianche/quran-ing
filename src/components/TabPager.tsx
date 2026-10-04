/**
 * TabPager — корневые вкладки и горизонтальный свайп между ними.
 *
 * ── Что делает ────────────────────────────────────────────────────────
 *
 * Владелец 2026-10-04: листать «Коран» ⇄ «Азкары» свайпом, как страницы в
 * iOS. Палец ведёт страницу один к одному, соседняя выезжает рядом;
 * отпускание доводит до ближайшей вкладки (дальше 35 % ширины или быстрым
 * взмахом — перелистнуть, иначе вернуть). За крайней вкладкой — резинка.
 * Перелистывание идёт тем же путём, что тап по вкладке (`onSwipe` = тот же
 * обработчик, что у TabBar), поэтому история, позиция прокрутки и обе
 * панели вкладок — веб-капсула и системная iOS 26 — переключаются сами.
 * При «Уменьшении движения» страница за пальцем не едет: жест только
 * меняет вкладку.
 *
 * ── Обе вкладки живут в DOM ──────────────────────────────────────────
 *
 * Чтобы соседняя страница появлялась под пальцем мгновенно, её нельзя
 * монтировать в начале жеста: список из 114 сур раскладывается ~100 мс, и
 * свайп начинался бы с рывка. Поэтому неактивная вкладка не
 * размонтируется, а лежит отдельным слоем во весь экран
 * (`position: fixed`, скрыта, без касаний, `inert`). Её раскладка
 * поддерживается в актуальном виде, и на свайпе остаётся только сделать
 * слой видимым и сдвинуть. Заодно возврат на вкладку тапом стал без
 * повторного монтирования. Вкладку, где человек ещё не был, монтируем
 * через `PREMOUNT_MS` после старта — к первому свайпу она готова.
 *
 * ── Почему сдвиг через `left`, а не transform ─────────────────────────
 *
 * Экраны прокручивают само окно, а шапка каждой вкладки —
 * `position: fixed` внутри неё. Transform (и `will-change: transform`) на
 * странице сделал бы её опорой для fixed-потомков: на прокрученном списке
 * шапка улетела бы к началу документа (та же причина, по которой
 * navTransition.ts анимирует снимками). `left` у относительно
 * позиционированной страницы опорой не становится: содержимое едет, а
 * шапки обеих вкладок стоят на месте и перетекают одна в другую по
 * прозрачности. Мини-плеер и нижняя панель лежат вне страниц и не
 * двигаются вовсе.
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
  type CSSProperties,
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
 * Неактивная — слой во весь экран, скрытый и без касаний. `visibility`, а
 * не `display: none`: раскладка сохраняется, и показать слой на свайпе —
 * это перерисовка, а не раскладка 114 строк заново.
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
  visibility: 'hidden',
  pointerEvents: 'none',
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
  el.style.transition = '';
}

/** Внутренний слой страницы: ему на свайпе ставится сдвиг прокрутки. */
const BODY_STYLE: CSSProperties = { position: 'relative' };

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

/** Что сохранить у шапки, чтобы вернуть её как было. */
type SavedHeader = { el: HTMLElement; opacity: string; transition: string };

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
  fadeIn,
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
  /** Проиграть короткое проявление, если вкладку сменили не свайпом. */
  fadeIn: boolean;
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
  /** Вкладка, на которую перелистнули свайпом: ей проявление не нужно. */
  const swipedToRef = useRef<TabId | null>(null);
  const savedHeadersRef = useRef<SavedHeader[]>([]);
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
    const header = (el: HTMLElement | null) => el?.querySelector<HTMLElement>('.screen-header') ?? null;

    const clearTimer = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = 0;
    };

    /**
     * Снять незавершённый довод: слушатель `transitionend` и его колбэк.
     * Без этого довод, перебитый тапом по вкладке или выключением пейджера,
     * оставался бы подписан на страницу, и следующий же переход `left` на
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
     * касания по ним не принимаются (тап по уезжающей строке открыл бы суру
     * с чужой вкладки) и окно не прокручивается.
     */
    const setBusy = (next: 'idle' | 'settling' | 'committing') => {
      busyRef.current = next;
      const busy = next !== 'idle';
      root.style.pointerEvents = busy ? 'none' : '';
      lockScroll(busy);
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
      if (!swallowClick) return;
      swallowClick = false;
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
     * Подготовить слои один раз за жест.
     *
     * На время жеста обе страницы — слои во весь экран, и движет их `left`.
     * Текущую страницу тоже переводим в такой слой, а не двигаем в потоке:
     * сдвиг элемента в потоке перерисовывает весь его текст на каждом кадре
     * (замер в Chromium ×4: задачи по 60–90 мс посреди свайпа), а у
     * закреплённого слоя меняется только его положение. Прокрутку окна при
     * этом сохраняем: корню даём прежнюю высоту документа, а содержимое
     * слоя сдвигаем на `scrollY` — кадр не меняется, и окно не съезжает.
     */
    const openLayers = (drag: Drag) => {
      const { order: tabs, scrollOf: scrollOfTab } = live.current;
      const currentId = tabs[drag.index];
      const current = page(currentId);
      if (!current) return;
      const scrollY = window.scrollY;
      root.style.minHeight = `${current.offsetHeight}px`;
      writePageStyle(current, { ...PARKED_STYLE, visibility: 'visible', pointerEvents: '' });
      const currentBody = body(currentId);
      if (currentBody) currentBody.style.top = `${-scrollY}px`;
      const { prev, next } = neighbours(drag.index);
      const saved: SavedHeader[] = [];
      const remember = (el: HTMLElement | null) => {
        const h = header(el);
        if (h) saved.push({ el: h, opacity: h.style.opacity, transition: h.style.transition });
      };
      remember(current);
      for (const id of [prev, next]) {
        const el = page(id);
        const inner = body(id);
        if (!id || !el) continue;
        writePageStyle(el, { visibility: 'visible' });
        // Соседняя страница показывается там, где человек её оставил.
        if (inner) inner.style.top = `${-scrollOfTab(id)}px`;
        remember(el);
      }
      savedHeadersRef.current = saved;
      drag.layered = true;
    };

    /** Положение кадра: только left страниц и прозрачность шапок. */
    const paint = (drag: Drag, offset: number) => {
      const { order: tabs } = live.current;
      const { prev, next } = neighbours(drag.index);
      const w = drag.width;
      const current = page(tabs[drag.index]);
      const prevEl = page(prev);
      const nextEl = page(next);
      if (current) current.style.left = `${offset}px`;
      if (prevEl) prevEl.style.left = `${offset - w}px`;
      if (nextEl) nextEl.style.left = `${offset + w}px`;
      // Шапки перетекают только в сторону, где есть сосед; на резинке
      // своя шапка остаётся как есть.
      const progress = Math.min(1, Math.abs(offset) / Math.max(1, w));
      const toward = offset < 0 ? nextEl : offset > 0 ? prevEl : null;
      const currentHeader = header(current);
      if (currentHeader) currentHeader.style.opacity = String(toward ? 1 - progress : 1);
      const prevHeader = header(prevEl);
      if (prevHeader) prevHeader.style.opacity = String(offset > 0 ? progress : 0);
      const nextHeader = header(nextEl);
      if (nextHeader) nextHeader.style.opacity = String(offset < 0 ? progress : 0);
    };

    const setTransition = (drag: Drag, on: boolean) => {
      const { order: tabs } = live.current;
      const { prev, next } = neighbours(drag.index);
      const move = on ? `left ${SWIPE_SETTLE_MS}ms ${SWIPE_EASING}` : 'none';
      const fade = on ? `opacity ${SWIPE_SETTLE_MS}ms ${SWIPE_EASING}` : 'none';
      for (const id of [tabs[drag.index], prev, next]) {
        const el = page(id);
        if (!el) continue;
        el.style.transition = move;
        const h = header(el);
        if (h) h.style.transition = fade;
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
      for (const { el, opacity, transition } of savedHeadersRef.current) {
        el.style.opacity = opacity;
        el.style.transition = transition;
      }
      savedHeadersRef.current = [];
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
        if (event.target === current && event.propertyName === 'left') finish();
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
      swipedToRef.current = id;
      setBusy('committing');
      live.current.onSwipe(id);
      // Если вкладка не сменилась (переход отклонён), страницы не должны
      // остаться сдвинутыми.
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        if (busyRef.current !== 'committing') return;
        swipedToRef.current = null;
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
      swipedToRef.current = null;
      stopAll();
    };
  }, [enabled]);

  // Смена вкладки. После свайпа — снять слои в том же кадре, где React
  // переставил страницы (до отрисовки), иначе мелькнёт промежуточное
  // положение. После тапа — короткое проявление, как прежде у всего экрана.
  const lastActiveRef = useRef(active);
  useLayoutEffect(() => {
    if (lastActiveRef.current === active) return;
    lastActiveRef.current = active;
    const swiped = swipedToRef.current === active;
    swipedToRef.current = null;
    if (busyRef.current !== 'idle' || dragRef.current) stopRef.current();
    if (swiped || !fadeIn || prefersReducedMotion()) return;
    const el = pageRefs.current[active];
    // Те же 150 мс и кривая, что у `.app-screen-enter` (index.css): прежде
    // при смене вкладки проявлялся весь экран, теперь — только страница,
    // панели остаются на месте.
    el?.animate?.(
      [{ opacity: 0.72 }, { opacity: 1 }],
      { duration: 150, easing: 'cubic-bezier(.22, 1, .36, 1)' },
    );
  }, [active, fadeIn]);

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
            <div ref={el => { bodyRefs.current[id] = el; }} style={BODY_STYLE}>
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
