/**
 * tabSwipe — арифметика горизонтального свайпа между вкладками.
 *
 * Только числа, без DOM: распознавание направления, резинка за крайними
 * вкладками, скорость пальца и решение «перелистнуть или вернуть». Касания
 * и отрисовка — в src/components/TabPager.tsx. Вынесено сюда, чтобы правила
 * жеста проверялись тестом (scripts/test-tab-swipe.mjs) без браузера: на
 * телефоне ошибка в них выглядит как «иногда не листается» и не ловится
 * глазами.
 *
 * Знак сдвига: отрицательный — страница уехала влево, открывается
 * СЛЕДУЮЩАЯ вкладка (правая в нижней панели); положительный — предыдущая.
 *
 * Числа, которых Apple не публикует (порог фиксации, скорость флика,
 * коэффициент резинки), подобраны на глаз под листание страниц в iOS
 * (`UIPageViewController`, `UIScrollView` с `isPagingEnabled`) — это не
 * правило Apple, а наш замер.
 */

/** Сдвиг пальца, после которого направление жеста считается выбранным, px. */
export const SWIPE_LOCK_PX = 10;
/**
 * Полоса у левого края, где жест не начинается, px. Там системный «назад»
 * iOS (IosEdgeBackGesture) и полоса быстрой прокрутки списка сур: палец у
 * самого края — это почти всегда они, а не листание вкладок.
 */
export const SWIPE_EDGE_GUARD_PX = 24;
/** Доля ширины экрана, после которой отпускание перелистывает вкладку. */
export const SWIPE_COMMIT_PROGRESS = 0.35;
/** Скорость флика, px/мс (≈ 500 pt/с): быстрый короткий взмах тоже листает. */
export const SWIPE_FLICK_VELOCITY = 0.5;
/** Минимальный сдвиг для флика, px: дрожь пальца на месте флик не даёт. */
export const SWIPE_FLICK_MIN_PX = 24;
/** Окно, по которому считается скорость пальца на отпускании, мс. */
export const SWIPE_VELOCITY_WINDOW_MS = 100;
/** Довод страницы на место после отпускания, мс. */
export const SWIPE_SETTLE_MS = 300;
/**
 * Кривая довода — та же «пружина без отскока», что у шторок и меню
 * приложения (index.css, `.pulldown-menu`; ReadingSettings).
 */
export const SWIPE_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** Жёсткость резинки за крайней вкладкой — коэффициент `UIScrollView`. */
const RUBBER_BAND = 0.55;

export type SwipeAxis = 'horizontal' | 'vertical';

/**
 * Выбрать направление жеста по сдвигу от точки касания.
 *
 * `null` — ещё рано: палец не ушёл дальше порога. Горизонталь требует,
 * чтобы сдвиг вбок был больше вертикального: прокрутка списка пальцем
 * почти никогда не идёт строго вертикально, и равный сдвиг отдаётся ей.
 */
export function lockAxis(dx: number, dy: number): SwipeAxis | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < SWIPE_LOCK_PX && ay < SWIPE_LOCK_PX) return null;
  return ax > ay ? 'horizontal' : 'vertical';
}

/**
 * Резинка: чем дальше тянут за край, тем меньше страница поддаётся, и
 * дальше ширины экрана она не уедет никогда. Формула `UIScrollView`:
 * (1 − 1 / (x·c / d + 1)) · d.
 */
export function rubberBand(raw: number, width: number): number {
  const d = Math.max(1, width);
  const sign = raw < 0 ? -1 : 1;
  const x = Math.abs(raw);
  return sign * (1 - 1 / ((x * RUBBER_BAND) / d + 1)) * d;
}

/**
 * Сдвиг страницы под пальцем.
 *
 * В сторону, где есть соседняя вкладка, — один к одному, но не дальше
 * ширины экрана. В сторону, где соседа нет, — резинка.
 */
export function dragOffset(raw: number, width: number, hasPrev: boolean, hasNext: boolean): number {
  if (raw < 0) return hasNext ? Math.max(-width, raw) : rubberBand(raw, width);
  if (raw > 0) return hasPrev ? Math.min(width, raw) : rubberBand(raw, width);
  return 0;
}

export type SwipeSample = { t: number; x: number };

/**
 * Скорость пальца по последним `SWIPE_VELOCITY_WINDOW_MS` мс, px/мс.
 *
 * Не по всему жесту: человек может долго вести страницу, а потом резко
 * бросить её — решать должен последний взмах, а не средняя за жест. Окно
 * отсчитывается от последней точки, а последней точкой вызывающий кладёт
 * само отпускание: если палец перед ним постоял, в окне окажутся точки на
 * одном месте, и скорость честно выйдет около нуля.
 */
export function velocityOf(samples: readonly SwipeSample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = last;
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    if (last.t - samples[i].t > SWIPE_VELOCITY_WINDOW_MS) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return (last.x - first.x) / dt;
}

/**
 * Куда довести страницу после отпускания: +1 — следующая вкладка, −1 —
 * предыдущая, 0 — вернуть на место.
 *
 * Листаем, если страницу протащили дальше `SWIPE_COMMIT_PROGRESS` ширины
 * или бросили быстрым взмахом в ту же сторону. Взмах НАЗАД отменяет даже
 * далеко протащенную страницу — так ведёт себя и iOS: передумал, махнул
 * обратно, страница вернулась.
 */
export function releaseTarget({ offset, velocity, width, hasPrev, hasNext }: {
  offset: number;
  velocity: number;
  width: number;
  hasPrev: boolean;
  hasNext: boolean;
}): -1 | 0 | 1 {
  const toward: -1 | 1 = offset < 0 ? 1 : -1;
  if (offset === 0) return 0;
  if (toward === 1 && !hasNext) return 0;
  if (toward === -1 && !hasPrev) return 0;
  const progress = Math.abs(offset) / Math.max(1, width);
  // Скорость в сторону листания положительна; против — отрицательна.
  const along = -velocity * toward;
  if (along <= -SWIPE_FLICK_VELOCITY) return 0;
  if (progress >= SWIPE_COMMIT_PROGRESS) return toward;
  if (Math.abs(offset) >= SWIPE_FLICK_MIN_PX && along >= SWIPE_FLICK_VELOCITY) return toward;
  return 0;
}
