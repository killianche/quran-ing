/**
 * launchReveal — появление приложения после заставки.
 *
 * Решение владельца 2026-10-04: «при загрузке анимацию прям сделай плавную
 * классную, немножко премиальную, появляющуюся».
 *
 * ── Как устроено ───────────────────────────────────────────────────────
 *
 * 1. Системная заставка. iOS LaunchScreen — фото рядов молящихся в тёплой
 *    тонировке со знаком QALB/قلب по центру (решение владельца 2026-11-15;
 *    scripts/brand/qalb-recolor.py). Android SplashScreen API фото не умеет:
 *    там поле #221a11 и тот же знак.
 * 2. В index.html лежит её точная копия — блок #launch: то же фото (cover =
 *    aspectFill), тот же знак того же размера в той же точке (геометрию
 *    считает инлайновый скрипт там же). Он на экране с первого кадра HTML,
 *    ещё до JavaScript, поэтому и на сайте нет вспышки пустой страницы. На
 *    Android фото в копии проявляется поверх поля.
 * 3. Здесь: ждём, пока фото и знак декодированы и React отрисовал первый
 *    кадр, снимаем системную заставку БЕЗ затухания (под ней та же картинка —
 *    шва не видно) и запускаем анимацию на #launch: знак мягко подрастает,
 *    за ним раскрывается тёплое свечение, проявляется «Quran Ing»; затем слой
 *    растворяется, и под ним уже готовый главный экран. Потом #launch
 *    удаляется из DOM.
 *
 * Анимация — только transform/opacity (композитор, без перерисовки текста).
 * prefers-reduced-motion: без движения, короткое растворение.
 * Ключевые кадры — в index.html рядом с #launch.
 */

import { hideSplashNow } from './nativeSplash';
import { releaseLaunchStatusBar } from './nativeStatusBar';
import { markLaunchFaded } from './nativeTabBar';

/** Сколько ждать декодирования фото и знака, прежде чем идти без них. */
const DECODE_TIMEOUT_MS = 1500;
/** Подстраховка, если `animationend` не придёт (вкладка в фоне и т.п.). */
const REVEAL_FALLBACK_MS = 2600;
/** Начало растворения слоя: 54 % от 1250 мс (keyframes launch-out в index.html). */
const FADE_START_MS = 675;
/**
 * Android: сколько фото держится на экране до появления приложения —
 * проявление 450 мс (launch-photo-in) и короткая пауза. Системная заставка
 * Android фото показать не умеет, без паузы оно мелькнуло бы на долю
 * секунды, а владелец хотел видеть его заставкой (2026-11-15).
 */
const ANDROID_PHOTO_HOLD_MS = 950;

let started = false;

function afterTwoFrames(fn: () => void): void {
  // setTimeout, а не только rAF: в скрытой вкладке rAF не тикает
  // (CLAUDE.md, грабли № 5), и заставка осталась бы навсегда.
  let done = false;
  const run = () => { if (!done) { done = true; fn(); } };
  requestAnimationFrame(() => requestAnimationFrame(run));
  window.setTimeout(run, 120);
}

function decoded(images: HTMLImageElement[]): Promise<void> {
  const decodes = images.map(img => (img.decode ? img.decode().catch(() => undefined) : Promise.resolve()));
  const timeout = new Promise<void>(resolve => window.setTimeout(resolve, DECODE_TIMEOUT_MS));
  return Promise.race([Promise.all(decodes).then(() => undefined), timeout]);
}

/** Запустить появление. Вызывается один раз, после монтирования App. */
export function runLaunchReveal(): void {
  if (started || typeof document === 'undefined') return;
  started = true;

  const overlay = document.getElementById('launch');
  if (!overlay) {
    releaseLaunchStatusBar();
    markLaunchFaded();
    afterTwoFrames(() => { void hideSplashNow(); });
    return;
  }
  const images = Array.from(overlay.querySelectorAll<HTMLImageElement>('img'));

  void decoded(images).then(() => {
    afterTwoFrames(() => {
      void hideSplashNow();
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const androidPhoto = !reduce && overlay.classList.contains('launch--android');
      if (androidPhoto) overlay.classList.add('launch--photo');
      window.setTimeout(() => reveal(overlay, Boolean(reduce)), androidPhoto ? ANDROID_PHOTO_HOLD_MS : 0);
    });
  });
}

/** Анимация ухода #launch и его удаление. */
function reveal(overlay: HTMLElement, reduce: boolean): void {
  overlay.classList.add(reduce ? 'launch--quick' : 'launch--reveal');
  // Статус-бар — тону темы, как только слой начинает растворяться
  // (launch-out держит его непрозрачным до 54 %), а не после удаления:
  // иначе на светлой теме ~0,6 с белые часы на светлом экране.
  // Системная панель вкладок iOS 26 — с того же момента: над
  // непрозрачной заставкой она висела бы одна поверх фото.
  window.setTimeout(() => {
    releaseLaunchStatusBar();
    markLaunchFaded();
  }, reduce ? 0 : FADE_START_MS);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    overlay.remove();
    releaseLaunchStatusBar();
  };
  overlay.addEventListener('animationend', event => {
    if (event.target === overlay) remove();
  });
  window.setTimeout(remove, REVEAL_FALLBACK_MS);
}
