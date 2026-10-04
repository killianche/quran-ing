/**
 * useChunkedRender — progressive disclosure для длинных списков.
 *
 * Вместо полной виртуализации (которая ломает scroll-restore +
 * audio-sync + anchor-jump в SurahScreen) — рендерим первые N
 * элементов сразу, а остальные добавляем батчами через
 * requestIdleCallback.  Первый paint Бакары становится мгновенным
 * (30 ayah'ей вместо 286), но через 1-2 секунды весь список
 * mount'ится — все эффекты, основанные на полном DOM, работают как
 * раньше.
 *
 * Когда `forceUpTo` задано — visibleCount подскакивает до этого
 * значения сразу (используется для initialAyah-jump: если просили
 * прыгнуть на ayah 250, нужно гарантировать что он mount'нут).
 *
 * Если браузера нет requestIdleCallback (Safari и WKWebView его не
 * поддерживают) — запасной путь на setTimeout с паузой между батчами.
 *
 * ── Плавность открытия (2026-10-04, Quran Ing) ─────────────────────────
 *
 * Замер (Chromium, процессор ×4): после открытия Аль-Бакары батчи по 30
 * аятов шли задачами по 50–175 мс одна за другой — в WKWebView, где нет
 * requestIdleCallback, каждые 16 мс, прямо во время выезда экрана. Отсюда
 * «подлагивание» при открытии суры. Теперь:
 *   • первый батч ждёт `startDelay` — выезд экрана (420 мс) идёт без
 *     конкурентов на главном потоке;
 *   • батчи мелкие и с паузой — каждая задача короче кадра, прокрутка и
 *     касания между ними успевают.
 */
import { useEffect, useRef, useState } from 'react';

type Options = {
  /** Сколько mount'нуть на первый paint.  Default 30. */
  initial?: number;
  /** Размер батча на каждый idle-tick.  Default 30. */
  batch?: number;
  /** Минимальный visibleCount — поднимется до этого значения сразу.
   *  Полезно когда нужно гарантировать, что определённый элемент
   *  уже в DOM (jump to ayah-anchor). */
  forceUpTo?: number;
  /** Идентичность списка. Нужна, когда две разные суры имеют одинаковое
   *  число аятов: одного `total` недостаточно, чтобы понять, что список
   *  действительно сменился. */
  resetKey?: string | number;
  /** Пауза перед первым батчем после монтирования/смены списка, мс. */
  startDelay?: number;
};

/** Пауза между батчами там, где нет requestIdleCallback, мс. */
const FALLBACK_GAP_MS = 24;

const ric: (cb: () => void) => number =
  (typeof window !== 'undefined' && 'requestIdleCallback' in window)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (cb) => (window as any).requestIdleCallback(cb, { timeout: 200 })
    : (cb) => window.setTimeout(cb, FALLBACK_GAP_MS);

const cic: (id: number) => void =
  (typeof window !== 'undefined' && 'cancelIdleCallback' in window)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (id) => (window as any).cancelIdleCallback(id)
    : (id) => window.clearTimeout(id);

export function useChunkedRender(total: number, opts: Options = {}): number {
  const { initial = 30, batch = 30, forceUpTo, resetKey, startDelay = 0 } = opts;
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.min(total, Math.max(initial, forceUpTo ?? 0))
  );
  /** Следующий батч — первый после монтирования или смены списка. */
  const firstBatchRef = useRef(true);
  /** Когда начался отсчёт `startDelay`: подъём границы (forceUpTo) не
   *  должен перезапускать паузу заново. */
  const startedAtRef = useRef(Date.now());

  // Сбрасываемся только при смене самого списка. `forceUpTo` сюда не входит:
  // активный аят меняется во время аудио, и прежний эффект из-за этого мог
  // УМЕНЬШИТЬ уже смонтированную ленту, удалить хвост DOM и резко изменить
  // scrollHeight прямо во время чтения.
  useEffect(() => {
    firstBatchRef.current = true;
    startedAtRef.current = Date.now();
    setVisibleCount(Math.min(total, Math.max(initial, forceUpTo ?? 0)));
    // `forceUpTo` намеренно читается только в момент настоящего reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, initial, resetKey]);

  // В пределах одной суры граница может двигаться только вперёд.
  useEffect(() => {
    if (forceUpTo == null) return;
    setVisibleCount(current => Math.min(total, Math.max(current, forceUpTo)));
  }, [forceUpTo, total]);

  // Schedule idle-render до тех пор, пока не покрыт весь total.
  useEffect(() => {
    if (visibleCount >= total) return;
    let cancelled = false;
    let idleId = 0;
    const schedule = () => {
      idleId = ric(() => {
        if (cancelled) return;
        firstBatchRef.current = false;
        setVisibleCount(v => Math.min(total, v + batch));
      });
    };
    // Таймер, а не rAF: в скрытой вкладке rAF не тикает (CLAUDE.md, № 5).
    const wait = firstBatchRef.current
      ? Math.max(0, startedAtRef.current + startDelay - Date.now())
      : 0;
    const delayId = wait > 0 ? window.setTimeout(schedule, wait) : (schedule(), 0);
    return () => {
      cancelled = true;
      if (delayId) window.clearTimeout(delayId);
      if (idleId) cic(idleId);
    };
  }, [visibleCount, total, batch, startDelay]);

  return visibleCount;
}
