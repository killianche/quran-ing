// Заглушка @capacitor/device: версия системы — из globalThis.__nativeMock.
export const Device = {
  getInfo: async () => ({ osVersion: globalThis.__nativeMock.osVersion }),
};
