/* Зонд вкладок (ветка lab/tab-shift, в main не идёт). Лог «LAB|…». */
window.__labNoTail = false; // LAB_VARIANT
(function () {
  const log = (...a) => console.log('LAB|' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
  const t0 = Date.now();
  let last = '';
  function snap() {
    const root = document.querySelector('[data-tab-pager]');
    if (!root) return null;
    const q = document.querySelector('[data-tab-page="quran"]');
    const inp = document.querySelector('[data-tab-scroller="quran"] input');
    return {
      x: Math.round(root.scrollLeft * 10) / 10,
      qLeft: q ? Math.round(q.getBoundingClientRect().left * 10) / 10 : null,
      inLeft: inp ? Math.round(inp.getBoundingClientRect().left * 10) / 10 : null,
      noTail: !!window.__labNoTail,
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
    log(ev, 't=' + (Date.now() - t0), Math.round(t.clientX), Math.round(t.clientY));
  }, { capture: true, passive: true }));
})();
