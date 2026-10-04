// Заглушка @capacitor/core для test-native-tabbar: платформа и наличие
// плагина берутся из globalThis.__nativeMock, который настраивает тест.
export const Capacitor = {
  getPlatform: () => globalThis.__nativeMock.platform,
  isPluginAvailable: name => globalThis.__nativeMock.plugins.includes(name),
};

// Локальные плагины приложения (TabBarOffset): вызовы — в __nativeMock.local.
export const registerPlugin = name => new Proxy({}, {
  get: (_t, method) => arg => {
    (globalThis.__nativeMock.local ??= []).push(`${name}.${String(method)}:${JSON.stringify(arg)}`);
    return Promise.resolve();
  },
});
