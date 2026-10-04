/**
 * navTransition — переходы между экранами как в навигации iOS.
 *
 * ── Зачем (владелец 2026-10-04) ────────────────────────────────────────
 *
 * «Скопируй стиль xtrud … переходы». В iOS новый экран выезжает справа, а
 * прежний уходит влево на треть и чуть темнеет; «назад» — обратное
 * движение. До этого здесь было короткое проявление (opacity 0.72 → 1).
 *
 * ── Почему View Transitions, а не transform на экране ──────────────────
 *
 * Экраны прокручивают само окно, а шапки, мини-плеер и панель внутри них —
 * `position: fixed`. Transform на контейнере экрана делает его опорой для
 * fixed-потомков: на прокрученной суре шапка улетела бы к началу документа
 * на всё время анимации. View Transitions снимают кадр страницы целиком
 * (старый — неподвижный снимок, новый — живое изображение) и двигают
 * снимки на композиторе: раскладка экранов не меняется, React не
 * перерисовывает каждый кадр.
 *
 * Поддержка: WebKit с iOS 18 (Safari 18), Chromium 111+ (Android WebView).
 * Где API нет (iOS 15–17) — прежнее проявление (`app-screen-enter`).
 *
 * ── Что НЕ анимируется здесь ───────────────────────────────────────────
 *
 *  • Возврат свайпом от края — у него своя интерактивная анимация
 *    (IosEdgeBackGesture); повторять её снимками значит показать уход
 *    дважды. App помечает такие возвраты как 'none'.
 *  • Смена вкладки — в iOS она мгновенная, без выезда.
 *  • Reduce Motion — без движения.
 *
 * Кривая и длительность — в src/index.css рядом с ключевыми кадрами
 * (`nav-push-*`, `nav-pop-*`). Apple параметров пружины навигации не
 * публикует; 0.42 с и cubic-bezier(.32,.72,0,1) подобраны на глаз под
 * UINavigationController.
 */

import { flushSync } from 'react-dom';

export type NavKind = 'push' | 'pop' | 'none';

function canAnimate(): boolean {
  if (typeof document === 'undefined') return false;
  if (typeof document.startViewTransition !== 'function') return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Применить смену экрана с переходом `kind`.
 *
 * Возвращает `true`, если переход запущен снимками. `false` — API нет или
 * движение выключено: смена уже применена синхронно, и вызывающий решает
 * сам, нужна ли запасная анимация.
 */
export function runNavTransition(kind: NavKind, update: () => void): boolean {
  if (kind === 'none' || !canAnimate()) {
    update();
    return false;
  }
  const root = document.documentElement;
  root.dataset.nav = kind;
  try {
    const transition = document.startViewTransition(() => {
      // Снимок нового состояния делается сразу после колбэка — React
      // обязан успеть отрисовать экран синхронно, иначе в снимок попадёт
      // старый.
      flushSync(update);
    });
    const clear = () => {
      if (root.dataset.nav === kind) delete root.dataset.nav;
    };
    transition.finished.then(clear, clear);
    // Переход, перебитый следующим, отклоняет `ready` — это штатно, а не
    // ошибка: смена экрана всё равно применена.
    transition.ready.catch(() => undefined);
  } catch {
    delete root.dataset.nav;
    update();
    return false;
  }
  return true;
}
