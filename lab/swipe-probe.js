/* Зонд вкладок (ветка lab/tab-swipe, в main не идёт). Лог «LAB|…». */
(function () {
  const log = (...a) => console.log('LAB|' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
  const t0 = Date.now();
  let last = '';
  function snap() {
    const root = document.querySelector('[data-tab-pager]');
    if (!root) return null;
    const pg = id => document.querySelector(`[data-tab-page="${id}"]`);
    const sc = id => document.querySelector(`[data-tab-scroller="${id}"]`);
    const q = pg('quran'), a = pg('azkar');
    return {
      x: Math.round(root.scrollLeft),
      qTop: sc('quran') ? Math.round(sc('quran').scrollTop) : null,
      qInert: q ? q.hasAttribute('inert') : null,
      aInert: a ? a.hasAttribute('inert') : null,
      sel: [...document.querySelectorAll('[aria-selected="true"],[aria-current="page"]')].map(e => e.textContent.trim()).join(','),
    };
  }
  let ready = false;
  setInterval(() => {
    const s = snap();
    if (!s) return;
    if (!ready) { ready = true; log('READY', { w: innerWidth, h: innerHeight }); }
    const k = JSON.stringify(s);
    if (k !== last) { last = k; log('t=' + (Date.now() - t0), s); }
  }, 50);
  ['touchstart', 'touchend'].forEach(ev => document.addEventListener(ev, e => {
    const t = e.changedTouches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    log(ev, 't=' + (Date.now() - t0), Math.round(t.clientX), Math.round(t.clientY), el ? (el.closest('[data-tab-page]')?.dataset.tabPage || el.tagName) : null);
  }, { capture: true, passive: true }));
})();
