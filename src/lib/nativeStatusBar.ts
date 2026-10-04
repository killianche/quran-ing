/**
 * StatusBar theme sync — соответствие цвета iOS/Android status bar'а
 * текущей теме приложения.  Только нативный платформо-specific
 * (в браузере no-op).
 *
 * Light themes → DARK иконки (чёрные на светлом фоне).
 * Dark / cosmic themes → LIGHT иконки (белые на тёмном).
 *
 * Без вызова system показывает status bar дефолтного цвета:
 * на iOS чёрный текст всегда (даже на cosmic-теме — выглядит грязно),
 * на Android — random из манифеста.
 *
 * Capacitor.StatusBar — единственное API: web-fallback пустой.
 */
import { themeMode, type Theme } from '../hooks/useTheme';
import { syncWebViewBackground } from './themeBackground';

let initialized = false;
/** Последняя запрошенная тема — применяется после снятия заставки. */
let pendingTheme: Theme | null = null;
/**
 * Пока на экране заставка (#launch, тёмно-красное поле), статус-бар держится
 * светлым при любой теме: тёмные часы на #440505 не читаются. Снимает
 * releaseLaunchStatusBar() из launchReveal.ts. Стартовый светлый стиль задают
 * Info.plist (UIStatusBarStyleLightContent — до запуска моста) и
 * capacitor.config.ts (StatusBar.style 'DARK' — при загрузке плагина).
 */
let launchHold = typeof document !== 'undefined' && !!document.getElementById('launch');
let StatusBarMod: typeof import('@capacitor/status-bar') | null = null;

async function loadStatusBar() {
  if (StatusBarMod) return StatusBarMod;
  try {
    StatusBarMod = await import('@capacitor/status-bar');
    return StatusBarMod;
  } catch {
    // В браузере Capacitor.StatusBar бросает — возвращаем null.
    return null;
  }
}

export async function syncStatusBarToTheme(theme: Theme) {
  pendingTheme = theme;
  if (launchHold) return;
  // Фон веб-вью — тем же моментом, что статус-бар: после заставки и на
  // смену темы (lib/themeBackground.ts).
  syncWebViewBackground();
  const mod = await loadStatusBar();
  if (!mod) return;
  const { StatusBar, Style } = mod;
  const mode = themeMode(theme);
  try {
    if (mode === 'light') {
      // Тёмный текст на светлом фоне.
      await StatusBar.setStyle({ style: Style.Light });
    } else {
      // Светлый текст на тёмном фоне (dark + cosmic).
      await StatusBar.setStyle({ style: Style.Dark });
    }
    initialized = true;
  } catch {
    // Не нативная платформа — silent fail.
  }
}

/** Заставка снята — вернуть статус-бару тон текущей темы. */
export function releaseLaunchStatusBar(): void {
  if (!launchHold) return;
  launchHold = false;
  if (pendingTheme) void syncStatusBarToTheme(pendingTheme);
}

export function isStatusBarInitialized(): boolean {
  return initialized;
}
