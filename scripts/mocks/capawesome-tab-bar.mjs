// Заглушка @capawesome/capacitor-tab-bar: пишет вызовы в журнал
// globalThis.__nativeMock.calls и падает на методах из .failOn.
const mock = () => globalThis.__nativeMock;
const call = (name, arg) => {
  mock().calls.push(arg === undefined ? name : `${name}:${JSON.stringify(arg)}`);
  if (mock().failOn.includes(name)) return Promise.reject(new Error(`${name} failed`));
  return Promise.resolve();
};
export const TabBar = {
  setTabs: opts => call('setTabs', opts.tabs.map(t => `${t.id}=${t.systemImage}`).join(',')),
  show: () => call('show'),
  hide: () => call('hide'),
  selectTabById: opts => call('select', opts.id),
  setColors: opts => call('colors', opts.selectedColor),
  addListener: async (event, fn) => {
    mock().calls.push(`listen:${event}`);
    mock().emit = fn;
    return { remove: async () => {} };
  },
};
