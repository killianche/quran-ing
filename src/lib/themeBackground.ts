/**
 * themeBackground — фон нативного веб-вью цветом страницы темы (iOS).
 *
 * Зачем: эффект края системной панели вкладок iOS 26 растворяет контент в
 * фон прокрутки веб-вью, а он по умолчанию тёмно-красный (#440505 —
 * заставка, `ios.backgroundColor`). На скриншоте владельца (сборка 2) под
 * панелью шла тёмно-красная полоса. Локальный плагин `ThemeBackground`
 * (ios/App/App/MainViewController.swift) ставит точный `--canvas` темы.
 *
 * Вызывается из nativeStatusBar.syncStatusBarToTheme — после заставки и на
 * каждую смену темы. Во время заставки фон остаётся тёмно-красным.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface ThemeBackgroundPlugin {
  setColor(options: { color: string }): Promise<void>;
}

const ThemeBackground = registerPlugin<ThemeBackgroundPlugin>('ThemeBackground');

export function syncWebViewBackground(): void {
  if (Capacitor.getPlatform() !== 'ios' || typeof document === 'undefined') return;
  const canvas = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim();
  if (!/^#[0-9a-f]{6}$/i.test(canvas)) return;
  // Старая сборка без плагина ответит отказом — фон тогда прежний.
  void ThemeBackground.setColor({ color: canvas }).catch(() => undefined);
}
