/**
 * TabPager — корневые вкладки «Плеер» | «Коран» | «Азкары» и листание между
 * ними.
 *
 * ── Листает iOS, а не мы (решение 2026-10-05) ─────────────────────────
 *
 * Владелец на iPhone (TestFlight, сборка 7): «когда свайпаю между Плеером,
 * Кораном, Азкарами, происходит дёргание». Прежний пейджер вёл листы своей
 * физикой (палец → transform, доводка CSS-переходом) и в WKWebView дёргался,
 * хотя в Chromium шёл ровно. Теперь лента вкладок — нативная горизонтальная
 * прокрутка с привязкой: в WKWebView такой контейнер прокручивает настоящий
 * `UIScrollView` (палец, инерция, резинка, остановка — системные, 120 Гц,
 * ноль JS на кадр). Тот же путь an-Nur прошёл с мусхафом (STATUS.md,
 * «2026-09-14 — Мусхаф листает системная прокрутка iOS»). Арифметика ленты
 * и история решения — src/lib/tabStrip.ts. Самодельную физику не
 * возвращать: её ловит страж в scripts/test-tab-swipe.mjs.
 *
 * ── Устройство ────────────────────────────────────────────────────────
 *
 *  • Лента — fixed-контейнер на весь экран: `overflow-x: auto`,
 *    `scroll-snap-type: x mandatory`. Страницы — ровно в ширину ленты
 *    (целый шаг, tabStep), `scroll-snap-stop: always`: одна вкладка за
 *    бросок.
 *  • У каждой страницы своя вертикальная прокрутка (`data-tab-scroller`).
 *    Окно на вкладках не прокручивается; экраны «поверх» (сура и прочие)
 *    по-прежнему прокручивают окно, а вкладки под ними паркуются (App).
 *    Позиция каждой вкладки хранится в её прокрутке сама.
 *  • Шапка страницы (CollapsingNavBar) живёт не в прокрутке, а над ней — в
 *    слое `data-tab-header-host` той же страницы (портал). Так она едет со
 *    своей страницей при листании и стоит на месте при вертикальной
 *    прокрутке. Сворачивание заголовка — по прокрутке страницы.
 *  • Подсветка в нижнем меню меняется на ходу (ближайшая страница, стор
 *    lib/tabLive.ts — App при этом не перерисовывается), а принятая
 *    вкладка — история, пауза тяжёлого — только когда лента остановилась
 *    (`onSettle`). `inert` со страницы, ставшей ближайшей, снимается сразу:
 *    первый вертикальный взмах после смены должен достаться ей.
 *  • Тап по вкладке — `scrollTo` плавно (при «Уменьшении движения» —
 *    сразу).
 *
 * ── Чего стоит нативная прокрутка ─────────────────────────────────────
 *
 *  • Тап по строке состояния iOS («наверх») прокручивает только окно
 *    WKWebView, а не вложенные прокрутки. На вкладках он больше не
 *    работает — известная цена. Наверх «Корана» ведёт двойной тап по его
 *    вкладке.
 *  • WebKit на iOS отдаёт положение прокрутки с запаздыванием (−10…+7 px)
 *    и не присылает `touchend`, когда жест забрала нативная прокрутка.
 *    Поэтому остановка — тишина событий плюс допуск (tabSettleTolerance),
 *    а не «палец убран» и не «до пикселя».
 */

import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { TabId } from './TabBar';
import { setLiveTab } from '../lib/tabLive';
import {
  isTabAligned,
  scrollLeftForTab,
  tabAtScrollLeft,
  tabProgress,
  tabSettleTolerance,
  tabStep,
  snapTailTarget,
} from '../lib/tabStrip';

/** Через сколько после старта монтировать вкладки, где ещё не были, мс. */
const PREMOUNT_MS = 1500;
/** Тишина событий прокрутки, после которой проверяем остановку, мс. */
const SETTLE_QUIET_MS = 120;
/** Палец держит ленту между страницами — проверяем снова через, мс. */
const SETTLE_POLL_MS = 250;

/**
 * Где живёт содержимое вкладки: её вертикальная прокрутка и слой для шапки
 * над ней. Экраны вкладок передают оба в LargeTitleHeader и меряют свою
 * прокрутку по `scroller`, а не по окну.
 */
export type TabFrame = { scroller: HTMLElement; headerHost: HTMLElement };

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Плавно, а при «Уменьшении движения» — сразу. */
function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'instant' : 'smooth';
}

/**
 * Прокрутить вкладку к началу (двойной тап по «Корану» в нижнем меню).
 * Окно на вкладках не прокручивается — прокручивается страница.
 */
export function scrollTabToTop(id: TabId): void {
  document.querySelector<HTMLElement>(`[data-tab-scroller="${id}"]`)
    ?.scrollTo({ top: 0, behavior: scrollBehavior() });
}

export function TabPager({
  order,
  active,
  enabled,
  onSettle,
  renderTab,
  fallback,
}: {
  /** Порядок вкладок — как в нижней панели, слева направо. */
  order: readonly TabId[];
  /** Принятая вкладка (App). */
  active: TabId;
  /** false — вкладки под экраном «поверх»: лента не принимает вкладок. */
  enabled: boolean;
  /** Лента остановилась на другой вкладке — принять её (как тап). */
  onSettle: (id: TabId) => void;
  renderTab: (id: TabId, isActive: boolean, frame: TabFrame | null) => ReactNode;
  /** Заглушка на время подгрузки чанка экрана. */
  fallback: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Partial<Record<TabId, HTMLDivElement | null>>>({});
  const scrollerRefs = useRef<Partial<Record<TabId, HTMLDivElement | null>>>({});
  const hostRefs = useRef<Partial<Record<TabId, HTMLDivElement | null>>>({});
  // Каждая вкладка, однажды смонтированная, остаётся в DOM: соседняя
  // страница видна под пальцем и обязана быть отрисована. Активная
  // монтируется сразу, остальные — через PREMOUNT_MS.
  const [mounted, setMounted] = useState<ReadonlySet<TabId>>(() => new Set([active]));
  const [step, setStep] = useState(0);
  const [frames, setFrames] = useState<Partial<Record<TabId, TabFrame>>>({});

  const live = useRef({ order, active, enabled, step, onSettle });
  live.current = { order, active, enabled, step, onSettle };

  /**
   * Вкладка, к которой лента едет по нашей команде (тап, «назад»): пока она
   * едет, подсветка не скачет по промежуточным, а остановка принимает только
   * её.
   */
  const programmaticRef = useRef<number | null>(null);
  /**
   * Ближайшая вкладка, о которой уже сообщено. На остановке и постановке
   * ленты — индекс принятой: первое событие прокрутки свайпа её же и
   * покажет, и стор подсветки зря не дёргается.
   */
  const liveIndexRef = useRef<number | null>(null);
  const settleTimerRef = useRef(0);
  /** Прокрутка страниц — вернуть её, если под экраном «поверх» её что-то
   *  сбросило. Сейчас парковка — сдвиг за край (App, Shell) и прокрутку
   *  хранит; страховка — на случай возврата к скрытию (`display: none`
   *  сбрасывал её в 0, так было на iOS до 18 до 2026-10-05). */
  const savedTopRef = useRef<Partial<Record<TabId, number>>>({});
  /** С чем лента ставилась в прошлый раз — отличить тап от старта. */
  const placedRef = useRef<{ step: number; enabled: boolean } | null>(null);

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

  // Прокрутка и слой шапки каждой страницы — экранам. Ссылки появляются
  // после первого коммита; в этом же кадре (до отрисовки) отдаём их детям.
  useLayoutEffect(() => {
    const next: Partial<Record<TabId, TabFrame>> = {};
    let changed = false;
    for (const id of order) {
      const scroller = scrollerRefs.current[id];
      const headerHost = hostRefs.current[id];
      if (!scroller || !headerHost) continue;
      const prev = frames[id];
      next[id] = prev && prev.scroller === scroller && prev.headerHost === headerHost
        ? prev
        : { scroller, headerHost };
      if (next[id] !== prev) changed = true;
    }
    if (changed) setFrames(next);
  });

  // Шаг ленты — целая ширина, пересчёт на resize и повороте.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setStep(tabStep(root.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  /** Панели, видимые не на всех вкладках (мини-плеер): прозрачность по ходу. */
  const paintChrome = (scrollLeft: number) => {
    const root = rootRef.current;
    const { order: tabs, step: w } = live.current;
    if (!root || !(w > 0)) return;
    const { from, to, t } = tabProgress(scrollLeft, w, tabs.length);
    const scope = root.parentElement ?? document.body;
    scope.querySelectorAll<HTMLElement>('[data-tab-chrome]').forEach(wrapper => {
      const shownOn = (wrapper.dataset.tabChrome ?? '').split(/\s+/);
      const a = shownOn.includes(tabs[from]) ? 1 : 0;
      const b = shownOn.includes(tabs[to]) ? 1 : 0;
      const value = String(a + (b - a) * t);
      for (const kid of Array.from(wrapper.children)) {
        if (kid instanceof HTMLElement && kid.style.opacity !== value) kid.style.opacity = value;
      }
    });
  };

  /** Страница стала ближайшей — снять с неё `inert` и `aria-hidden` сразу. */
  const openPage = (id: TabId) => {
    const el = pageRefs.current[id];
    if (!el) return;
    if (el.hasAttribute('inert')) el.removeAttribute('inert');
    if (el.hasAttribute('aria-hidden')) el.removeAttribute('aria-hidden');
  };

  /**
   * Вернуть `inert` и `aria-hidden` ровно по принятой вкладке — так, как их
   * ставит разметка React. Нужно после свайпа, вернувшегося на место:
   * React не знает, что соседняя страница на ходу была открыта, и сам
   * признаки ей не вернул бы.
   */
  const restPages = (activeId: TabId) => {
    for (const id of live.current.order) {
      const el = pageRefs.current[id];
      if (!el) continue;
      if (id === activeId) {
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
      } else {
        if (!el.hasAttribute('inert')) el.setAttribute('inert', '');
        if (el.getAttribute('aria-hidden') !== 'true') el.setAttribute('aria-hidden', 'true');
      }
    }
  };

  /** В покое видимостью панели правит `data-chrome-off` от React. */
  const clearChrome = () => {
    const scope = rootRef.current?.parentElement ?? document.body;
    scope.querySelectorAll<HTMLElement>('[data-tab-chrome] > *').forEach(kid => {
      if (kid.style.opacity) kid.style.opacity = '';
    });
  };

  // Лента: подсветка на ходу, остановка, память прокрутки страниц.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const clearSettle = () => {
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = 0;
    };
    /** Палец на ленте — пока он держит, хвост привязки не трогаем. */
    let fingerDown = false;
    /** Положение ленты на прошлом событии — куда она едет (snapTailTarget). */
    let prevX = Number.NaN;
    /** Сколько раз остановка ждала цель нашей прокрутки (см. settle). */
    let waitedTarget = 0;

    /**
     * Лента остановилась? Подтверждает тишина событий И положение в
     * допуске от страницы (см. tabSettleTolerance). Палец держит ленту
     * посреди перелистывания — проверяем снова позже. Положение не
     * дописываем: запись поверх системной привязки сдвинула бы страницу на
     * эти пиксели уже по-настоящему.
     */
    const settle = () => {
      settleTimerRef.current = 0;
      const { order: tabs, active: activeTab, enabled: on, step: w } = live.current;
      if (!on || !(w > 0)) return;
      const x = root.scrollLeft;
      if (!isTabAligned(x, w, tabSettleTolerance(w))) {
        settleTimerRef.current = window.setTimeout(settle, SETTLE_POLL_MS);
        return;
      }
      const index = tabAtScrollLeft(x, w, tabs.length);
      // Лента едет по тапу: промежуточная вкладка, на которой она на миг
      // выровнялась, — не остановка. Ждём цель, но не вечно: если человек
      // перехватил ленту так, что касания не было видно, принимаем то, где
      // она стоит.
      const target = programmaticRef.current;
      if (target != null && index !== target && waitedTarget < 8) {
        waitedTarget += 1;
        settleTimerRef.current = window.setTimeout(settle, SETTLE_POLL_MS);
        return;
      }
      waitedTarget = 0;
      programmaticRef.current = null;
      liveIndexRef.current = index;
      const id = tabs[index];
      if (id !== activeTab) {
        // Подсветку и `inert` у прежней снимет смена вкладки, прозрачность
        // панелей — постановка ленты (эффект ниже), уже после того, как React
        // переставит `data-chrome-off`, — иначе мелькнуло бы прежнее.
        live.current.onSettle(id);
      } else {
        setLiveTab(null);
        restPages(activeTab);
        clearChrome();
      }
    };

    const onScroll = () => {
      const { order: tabs, enabled: on, step: w } = live.current;
      if (!on || !(w > 0)) return;
      const x = root.scrollLeft;
      if (programmaticRef.current == null) {
        const index = tabAtScrollLeft(x, w, tabs.length);
        if (index !== liveIndexRef.current) {
          liveIndexRef.current = index;
          setLiveTab(tabs[index]);
          openPage(tabs[index]);
        }
      }
      paintChrome(x);
      // Хвост привязки после отпускания — ставим ленту на страницу сразу
      // (см. snapTailTarget: иначе первое касание списка уходит ленте).
      // Только без пальца и не во время нашей плавной прокрутки по тапу.
      if (!fingerDown && programmaticRef.current == null) {
        const target = snapTailTarget(x, w, tabs.length, prevX);
        if (target != null) root.scrollTo({ left: target, behavior: 'instant' });
      }
      prevX = x;
      clearSettle();
      settleTimerRef.current = window.setTimeout(settle, SETTLE_QUIET_MS);
    };

    // `scrollend` — точнее таймера, где он есть; в WebKit его может не быть,
    // тогда остановку найдёт таймер по последнему `scroll`.
    const onScrollEnd = (event: Event) => {
      if (event.target !== root) return;
      clearSettle();
      settle();
    };

    // Человек взялся за ленту посреди нашей прокрутки — подсветка снова
    // следует за пальцем.
    const onTouchStart = () => { programmaticRef.current = null; fingerDown = true; };
    const onTouchEnd = (event: TouchEvent) => { if (event.touches.length === 0) fingerDown = false; };

    // Прокрутка страниц — запоминаем на случай сброса парковкой. Событие
    // прокрутки не всплывает — ловим на погружении.
    const onPageScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement)) return;
      const id = el.dataset.tabScroller as TabId | undefined;
      // Сброс в 0 у скрытой (`display: none`) страницы — тоже событие
      // прокрутки, и может прийти, пока пейджер о парковке ещё не знает. У
      // скрытого так элемента нет ни одного прямоугольника — не запоминаем.
      if (!id || !live.current.enabled || el.getClientRects().length === 0) return;
      savedTopRef.current[id] = el.scrollTop;
    };

    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('scrollend', onScrollEnd, { passive: true });
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    root.addEventListener('touchcancel', onTouchEnd, { passive: true });
    root.addEventListener('scroll', onPageScroll, { passive: true, capture: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('scrollend', onScrollEnd);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('touchcancel', onTouchEnd);
      root.removeEventListener('scroll', onPageScroll, { capture: true } as EventListenerOptions);
      clearSettle();
    };
    // Обработчики читают свежее из `live` — вешаются один раз.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Поставить ленту на принятую вкладку: на старте, при смене ширины, после
  // тапа и системной «назад», после возврата из-под экрана «поверх».
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!enabled) {
      // Экран «поверх» открылся — возможно, посреди свайпа. Подсветка — на
      // принятую, а возврат поставит ленту сразу, без проезда через соседей,
      // если она вдруг не на месте.
      placedRef.current = null;
      programmaticRef.current = null;
      liveIndexRef.current = null;
      setLiveTab(null);
      clearChrome();
      return;
    }
    if (!root || !(step > 0)) return;
    const index = Math.max(0, order.indexOf(active));
    liveIndexRef.current = index;
    restPages(active);
    const x = root.scrollLeft;
    const there = tabAtScrollLeft(x, step, order.length) === index
      && isTabAligned(x, step, tabSettleTolerance(step));
    const placed = placedRef.current;
    placedRef.current = { step, enabled };
    if (there) {
      // Уже стоим (листали пальцем) — снять прозрачность панелей теперь,
      // когда React переставил их видимость.
      programmaticRef.current = null;
      clearChrome();
      return;
    }
    // Плавно — только на смену вкладки при той же ширине (тап, «назад»).
    // Старт, новая ширина, возврат из-под экрана «поверх» — сразу: там
    // лента не на месте и ехать через соседние страницы незачем.
    const sameFrame = placed != null && placed.step === step && placed.enabled === enabled;
    programmaticRef.current = index;
    root.scrollTo({
      left: scrollLeftForTab(index, step),
      behavior: sameFrame ? scrollBehavior() : 'instant',
    });
  }, [active, step, enabled, order]);

  // Возврат из-под экрана «поверх»: если прокрутку страниц что-то сбросило
  // (см. savedTopRef), вернуть её.
  useLayoutEffect(() => {
    if (!enabled) return;
    for (const id of order) {
      const el = scrollerRefs.current[id];
      const saved = savedTopRef.current[id];
      if (el && saved != null && Math.abs(el.scrollTop - saved) > 1) el.scrollTop = saved;
    }
  }, [enabled, order]);

  return (
    <div
      ref={rootRef}
      data-tab-pager=""
      className="no-scrollbar"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollSnapType: 'x mandatory',
        // Резинка на краях ленты — своя, не цепляется к окну.
        overscrollBehaviorX: 'contain',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {order.map(id => {
        const isActive = id === active;
        return (
          <div
            key={id}
            ref={el => { pageRefs.current[id] = el; }}
            data-tab-page={id}
            // Признак скрытой вкладки: пауза анимаций плиток (index.css).
            data-tab-parked={isActive ? undefined : ''}
            // aria-hidden и inert — по принятой вкладке; со страницы, ставшей
            // ближайшей, их снимает лента на ходу (openPage), остальным
            // возвращает на остановке (restPages). На отрисовку они не
            // влияют. React 18 атрибута inert не знает — пустой строкой. 🔴
            // На React 19 заменить на `inert={!isActive}`.
            aria-hidden={isActive ? undefined : true}
            {...(isActive ? {} : { inert: '' })}
            style={{
              position: 'relative',
              flex: '0 0 auto',
              width: step > 0 ? `${step}px` : '100%',
              height: '100%',
              scrollSnapAlign: 'start',
              // Одна вкладка за бросок: быстрый взмах с «Плеера» не пролетает
              // «Коран» до «Азкаров».
              scrollSnapStop: 'always',
            }}
          >
            <div
              ref={el => { scrollerRefs.current[id] = el; }}
              data-tab-scroller={id}
              style={{
                position: 'absolute',
                inset: 0,
                overflowX: 'hidden',
                overflowY: 'auto',
                // Резинка страницы не передаётся ленте и окну.
                overscrollBehaviorY: 'contain',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {(isActive || mounted.has(id)) && (
                // Своя граница на каждую вкладку: подгрузка чанка скрытой
                // вкладки не должна подменять заглушкой видимую.
                <Suspense fallback={fallback}>
                  {renderTab(id, isActive, frames[id] ?? null)}
                </Suspense>
              )}
            </div>
            {/* Слой шапки: над прокруткой страницы, на месте при вертикальной
                прокрутке, вместе со страницей при листании. Касания
                пропускает — кнопки шапки включают их себе сами. */}
            <div
              ref={el => { hostRefs.current[id] = el; }}
              data-tab-header-host=""
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 30,
                pointerEvents: 'none',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
