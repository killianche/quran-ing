/**
 * FastScrubber — быстрая прокрутка удержанием у левого края.
 *
 * Правила и выключатели — в `lib/fastScroll.ts`, здесь только касания и
 * отрисовка. Экран сам решает, что считать позицией: главная — суры, лента
 * — аяты. Компонент ничего не знает ни о тех, ни о других.
 *
 * ── Почему слушатели на окне, а не полоса-наложение ───────────────────
 *
 * Невидимый элемент поверх края перехватывал бы ВСЁ: тап по номеру суры
 * перестал бы открывать суру, а прокрутка большим пальцем у края встала
 * бы. Поэтому поверх ничего не лежит — окно слушает касания в полосе
 * `left…left+width` и забирает жест, только когда палец продержали
 * неподвижно `HOLD_MS`. До этого момента касание живёт своей жизнью.
 *
 * ── Почему касания, а не pointer-события ──────────────────────────────
 *
 * В WKWebView, как только браузер решает прокручивать, он шлёт
 * `pointercancel` и больше pointer-событий не даёт. `touchmove` с
 * `passive: false` и `preventDefault` после включения удерживает жест у
 * нас: страница под пальцем не едет, а номер меняется.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { HOLD_MS, HOLD_SLOP, scrubIndex } from '../lib/fastScroll';

/**
 * До какого момента жест считается быстрой прокруткой.
 *
 * Нужен экранам со своим распознаванием тапа на pointer-событиях: удержал
 * 220–340 мс и отпустил не двигая — для ленты это выглядело бы как тап, и
 * она прятала бы панели. `pointerup` приходит раньше, чем прыжок успевает
 * сдвинуть страницу, поэтому по прокрутке это не отличить — только так.
 */
let scrubbingUntil = 0;

/** Идёт быстрая прокрутка или только что закончилась. */
export function isScrubbing(): boolean {
  return performance.now() < scrubbingUntil;
}

type Props = {
  /** Выключатель места — из `FAST_SCROLL`. */
  enabled: boolean;
  /** Сколько всего позиций. */
  count: number;
  /** Полоса захвата по горизонтали, px от левого края экрана. */
  left: number;
  width: number;
  /** Границы дорожки: отступы от верха и от низа экрана, px. */
  topInset: number;
  /** Число или функция: у системной панели iOS 26 высота известна только
   *  по факту, её меряют в начале касания. */
  bottomInset: number | (() => number);
  /** Позиция под пальцем в момент включения (с единицы). */
  startAt: (y: number) => number;
  /**
   * Перейти к позиции. Во время протяжки зовётся не чаще кадра с
   * `final = false`, при отпускании — один раз с `true`.
   *
   * Вернуть `false`, если до позиции дойти не удалось: тогда номер не
   * считается применённым, и отпускание позовёт переход ещё раз, уже
   * окончательно. Нужно ленте: недомонтированный аят во время протяжки она
   * не монтирует (это перерисовка всего экрана посреди жеста), а докручивает
   * до последнего готового — и прыгает по-настоящему только при отпускании.
   */
  onScrub: (n: number, final: boolean) => boolean | void;
  /** Что показать в пузыре. */
  label: (n: number) => { big: string; small?: string };
  /**
   * Можно ли начать с этого места. Полоса по координатам ловит и то, что
   * лежит поверх списка: мини-плеер, нижний лист настроек, ползунок
   * перехода. Удержание на них включало прокрутку, дёргало ленту под ними и
   * глотало клик (ревью 10.09.2026). Экран знает, где его содержимое.
   */
  canStart?: (target: Element | null) => boolean;
};

type View = { n: number; y: number; bottom: number };

export function FastScrubber({
  enabled, count, left, width, topInset, bottomInset, startAt, onScrub, label, canStart,
}: Props) {
  const [view, setView] = useState<View | null>(null);

  // Свежие значения — в ref: обработчики касаний вешаются один раз, и
  // пересоздавать их на каждый рендер экрана незачем.
  const live = useRef({ count, startAt, onScrub, left, width, topInset, bottomInset, canStart });
  live.current = { count, startAt, onScrub, left, width, topInset, bottomInset, canStart };

  useEffect(() => {
    if (!enabled) return;

    let hold = 0;
    let frame = 0;
    let start: { x: number; y: number } | null = null;
    /**
     * `applied` — номер, к которому страница уже прыгнула. Отпускание зовёт
     * прыжок, только если последний номер ещё не применён: иначе палец,
     * просто лёгший на край во время чтения, переносил бы аят из середины
     * экрана к его верху (ревью 10.09.2026).
     */
    let active: { y0: number; n0: number; n: number; applied: number } | null = null;
    /** Гасить ОДИН следующий клик — тот, что порождает отпускание. */
    let swallowClick = false;
    let swallowTimer = 0;
    let savedSelect = '';

    /** Нижняя граница дорожки на текущий жест — снимается в начале касания. */
    let insetNow = 0;
    const resolveInset = () => {
      const b = live.current.bottomInset;
      return typeof b === 'function' ? b() : b;
    };
    const track = () => ({
      top: live.current.topInset,
      bottom: window.innerHeight - insetNow,
    });
    const inStrip = (x: number, y: number) => {
      const { left: l, width: w } = live.current;
      const { top, bottom } = track();
      return x >= l && x <= l + w && y >= top && y <= bottom;
    };

    const cancelHold = () => {
      if (hold) window.clearTimeout(hold);
      hold = 0;
    };

    const activate = () => {
      hold = 0;
      if (!start) return;
      const n0 = live.current.startAt(start.y);
      active = { y0: start.y, n0, n: n0, applied: n0 };
      // Долгое нажатие в WKWebView само начинает выделение текста, а
      // полоса на ленте частично лежит над первыми буквами перевода.
      // На время прокрутки выделение выключаем.
      const root = document.documentElement.style;
      savedSelect = root.webkitUserSelect;
      root.webkitUserSelect = 'none';
      window.getSelection()?.removeAllRanges();
      scrubbingUntil = Infinity;
      // 🔴 impact, а не selectionChanged. В плагине selectionChanged
      // срабатывает, только если генератор создан через selectionStart —
      // а его никто не вызывал, и вибрация на iOS молчала с самого начала
      // (Haptics.swift, ревью 10.09.2026).
      if (Capacitor.getPlatform() === 'ios') void Haptics.impact({ style: ImpactStyle.Light });
      setView({ n: n0, y: start.y, bottom: insetNow });
    };

    const finish = () => {
      cancelHold();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (active) {
        // Последний номер — без очереди кадров: палец отпущен, место
        // должно быть ровно тем, что было в пузыре. Но только если он ещё
        // не применён.
        if (active.n !== active.applied) live.current.onScrub(active.n, true);
        document.documentElement.style.webkitUserSelect = savedSelect;
        // Отпускание после прокрутки порождает click по тому, что под
        // пальцем. Открывать суру или аят человек не просил. Гасим ровно
        // один клик, а не всё подряд по таймеру: быстрый законный тап
        // следом должен сработать.
        swallowClick = true;
        if (swallowTimer) window.clearTimeout(swallowTimer);
        swallowTimer = window.setTimeout(() => { swallowClick = false; }, 600);
        scrubbingUntil = performance.now() + 450;
        setView(null);
      }
      active = null;
      start = null;
    };

    /**
     * Демонтаж посреди жеста — не отпускание. Экран уже уходит, и прыгать
     * по нему нельзя: только вернуть выделение и погасить таймеры.
     */
    const teardown = () => {
      cancelHold();
      if (frame) cancelAnimationFrame(frame);
      if (swallowTimer) window.clearTimeout(swallowTimer);
      frame = 0;
      if (active) document.documentElement.style.webkitUserSelect = savedSelect;
      active = null;
      start = null;
      swallowClick = false;
      scrubbingUntil = 0;
    };

    const onStart = (e: TouchEvent) => {
      // Новое касание — это уже другой жест: прошлое отпускание больше
      // ничего не гасит и тапом его не считают.
      swallowClick = false;
      scrubbingUntil = 0;
      if (e.touches.length !== 1) { finish(); return; }
      const t = e.touches[0];
      insetNow = resolveInset();
      if (!inStrip(t.clientX, t.clientY)) return;
      const ok = live.current.canStart;
      if (ok && !ok(e.target instanceof Element ? e.target : null)) return;
      start = { x: t.clientX, y: t.clientY };
      cancelHold();
      hold = window.setTimeout(activate, HOLD_MS);
    };

    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      if (!t) return;
      if (!active) {
        // Сдвинулся раньше, чем включилось — это обычная прокрутка или тап.
        if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > HOLD_SLOP) {
          cancelHold();
          start = null;
        }
        return;
      }
      e.preventDefault();
      const { top, bottom } = track();
      const n = scrubIndex({
        y: t.clientY, y0: active.y0, top, bottom, n0: active.n0, count: live.current.count,
      });
      setView({ n, y: t.clientY, bottom: insetNow });
      if (n === active.n) return;
      active.n = n;
      // Прыжок — не чаще кадра: touchmove приходит чаще частоты экрана, а
      // каждый прыжок в ленте может домонтировать аяты.
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (!active) return;
          if (live.current.onScrub(active.n, false) !== false) active.applied = active.n;
        });
      }
    };

    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('touchstart', onStart, { capture: true, passive: true });
    window.addEventListener('touchmove', onMove, { capture: true, passive: false });
    window.addEventListener('touchend', finish, { capture: true, passive: true });
    window.addEventListener('touchcancel', finish, { capture: true, passive: true });
    window.addEventListener('click', onClick, { capture: true });
    return () => {
      teardown();
      window.removeEventListener('touchstart', onStart, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchmove', onMove, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchend', finish, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchcancel', finish, { capture: true } as EventListenerOptions);
      window.removeEventListener('click', onClick, { capture: true } as EventListenerOptions);
    };
  }, [enabled]);

  if (!enabled || !view) return null;
  const text = label(view.n);

  return createPortal(
    <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 1100, pointerEvents: 'none' }}>
      {/* Дорожка у края — показывает, что жест пойман и где палец. */}
      <div style={{
        position: 'fixed',
        left: `${Math.max(6, left + width / 2 - 3)}px`,
        top: `${topInset}px`,
        bottom: `${view.bottom}px`,
        width: '6px',
        borderRadius: 'var(--radius-pill)',
        background: 'rgb(var(--ink-rgb) / 0.12)',
      }} />
      <div style={{
        position: 'fixed',
        left: `${Math.max(6, left + width / 2 - 3)}px`,
        top: `${view.y - 18}px`,
        width: '6px',
        height: '36px',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--text-primary)',
      }} />
      {/* Номер — крупно по центру, как в образце: глаз ловит его, пока
          палец занят у края. */}
      <div style={{
        position: 'fixed',
        left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        minWidth: '120px',
        padding: '14px 22px 12px',
        borderRadius: '22px',
        textAlign: 'center',
        background: 'rgb(var(--ink-rgb) / 0.82)',
        color: 'var(--surface)',
        boxShadow: '0 16px 40px -12px rgba(0,0,0,0.35)',
      }}>
        <div style={{
          fontSize: '46px', lineHeight: 1, fontWeight: 'var(--weight-semibold)',
          fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
        }}>
          {text.big}
        </div>
        {text.small && (
          <div style={{
            marginTop: '6px',
            fontSize: 'var(--font-footnote)', lineHeight: 'var(--leading-footnote)',
            opacity: 0.78,
            maxWidth: '200px',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {text.small}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
