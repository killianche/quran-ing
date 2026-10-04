/**
 * Хук загрузчика для scripts/test-native-tabbar.mjs: подменяет нативные
 * модули Capacitor заглушками из scripts/mocks/, остальное разрешает как
 * scripts/ts-resolve-hooks.mjs (дописывает .ts к путям без расширения).
 */
const MOCKS = {
  '@capacitor/core': './capacitor-core.mjs',
  '@capacitor/device': './capacitor-device.mjs',
  '@capawesome/capacitor-tab-bar': './capawesome-tab-bar.mjs',
};

export async function resolve(specifier, context, next) {
  if (specifier in MOCKS) {
    return { url: new URL(MOCKS[specifier], import.meta.url).href, shortCircuit: true };
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw err;
    for (const suffix of ['.ts', '.tsx', '/index.ts']) {
      try {
        return await next(specifier + suffix, context);
      } catch { /* пробуем следующий вариант */ }
    }
    throw err;
  }
}
