/**
 * Скрытие нативного сплэш-экрана.
 *
 * В capacitor.config.ts стоит `launchAutoHide: false` — сплэш держится
 * до явного вызова hide().  Смысл в том, чтобы пользователь не увидел
 * пустую канву в промежутке между «сплэш убрали» и «React отрисовал
 * первый кадр»: сначала монтируем дерево, потом снимаем заставку.
 *
 * ⚠️ В прежнем QuranIng этот флаг был выставлен, а вызова hide() в коде не
 * существовало — комментарий в конфиге утверждал, что «App.tsx делает
 * SplashScreen.hide() после первого rAF», но grep по src/ не находил
 * ни одного упоминания.  Нативное приложение зависло бы на заставке
 * навсегда.  Здесь вызов есть; страховка по таймауту ниже — на случай,
 * если первый кадр по какой-то причине не наступит.
 *
 * Импорт ленивый: в вебе пакет не нужен и не должен попадать в
 * главный чанк.
 */

/** Через сколько снять сплэш принудительно, даже если рендер завис. */
const FAILSAFE_MS = 4000;

let done = false;

async function hideNow(): Promise<void> {
  if (done) return;
  done = true;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    // Без затухания: под заставкой уже лежит её точная копия #launch из
    // index.html (lib/launchReveal.ts), и плавность даёт анимация копии.
    // Затухание заставки поверх копии дало бы двойное «проявление».
    await SplashScreen.hide({ fadeOutDuration: 0 });
  } catch {
    // Не нативная платформа — плагина нет, и скрывать нечего.
  }
}

/** Снять сплэш сейчас — зовёт launchReveal, когда копия заставки готова. */
export function hideSplashNow(): Promise<void> {
  return hideNow();
}

/** Страховка: снять сплэш через FAILSAFE_MS, даже если всё зависло. */
export function armSplashFailsafe(): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => { void hideNow(); }, FAILSAFE_MS);
}
