// Заглушка @capacitor/core для test-native-tabbar: платформа и наличие
// плагина берутся из globalThis.__nativeMock, который настраивает тест.
export const Capacitor = {
  getPlatform: () => globalThis.__nativeMock.platform,
  isPluginAvailable: name => globalThis.__nativeMock.plugins.includes(name),
};
