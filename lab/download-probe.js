/* Зонд загрузки сур (ветка lab/download-probe, в main не идёт). Пишет в консоль строки «LAB|…». */
(function () {
  const log = (...a) => console.log('LAB|' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
  const URL = 'https://quraning-audio.217-177-75-68.sslip.io/audio/merzhoev/067.mp3';
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const timed = async (name, p) => {
    const t = Date.now();
    const to = new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT 45s')), 45000));
    try { const r = await Promise.race([p, to]); log(name, 'ok', (Date.now() - t) + 'ms'); return r; }
    catch (e) { log(name, 'FAIL', (Date.now() - t) + 'ms', String(e && (e.message || e))); return null; }
  };
  async function run() {
    for (let i = 0; i < 60 && !(window.Capacitor && window.Capacitor.Plugins && window.__lab); i++) await wait(500);
    const C = window.Capacitor;
    log('READY', { native: C && C.isNativePlatform && C.isNativePlatform(), plugins: C ? Object.keys(C.Plugins || {}).slice(0, 30) : null, lab: !!window.__lab });
    const H = C.Plugins.CapacitorHttp, F = C.Plugins.Filesystem;
    // 1) проба размера
    const p = await timed('probe', H.request({ url: URL, method: 'GET', responseType: 'blob', headers: { Range: 'bytes=0-0' } }));
    if (p) log('probe-res', { status: p.status, headers: p.headers, dataType: typeof p.data, dataLen: p.data && p.data.length });
    // 2) кусок 1 МБ
    const c = await timed('chunk1MB', H.request({ url: URL, method: 'GET', responseType: 'blob', headers: { Range: 'bytes=0-1048575' }, connectTimeout: 30000, readTimeout: 30000 }));
    if (c) log('chunk-res', { status: c.status, dataType: typeof c.data, dataLen: c.data && c.data.length, head: typeof c.data === 'string' ? c.data.slice(0, 16) : null });
    // 3) запись файла
    if (c && typeof c.data === 'string') {
      await timed('writeFile', F.writeFile({ directory: 'LIBRARY_NO_CLOUD', path: 'lab/test.mp3', data: c.data, recursive: true }));
      const st = await timed('stat', F.stat({ directory: 'LIBRARY_NO_CLOUD', path: 'lab/test.mp3' }));
      if (st) log('stat-res', { size: st.size, type: st.type });
    }
    // 4) настоящий загрузчик приложения — пока играет поток той же суры
    const lab = window.__lab;
    if (lab) {
      try { const a = new Audio(URL); window.__labAudio = a; await a.play(); log('stream-playing'); } catch (e) { log('stream-play-failed', String(e)); }
      await wait(3000);
      log('stream-time', window.__labAudio && window.__labAudio.currentTime);
      log('real-start', lab.dl.getDownloadState('merzhoev'));
      lab.dl.startDownload('merzhoev', { kind: 'surah', surah: 68 }).then(() => log('real-start-resolved'), e => log('real-start-rejected', String(e)));
      for (let s = 0; s < 90; s++) {
        await wait(1000);
        const st = lab.dl.getDownloadState('merzhoev');
        if (s % 3 === 0 || st.status !== 'running') log('real-state', s, { status: st.status, bytes: st.bytes, bytesTotal: st.bytesTotal, error: st.error, file: lab.store.hasSurahFile('merzhoev', 68), streamT: window.__labAudio && Math.round(window.__labAudio.currentTime) });
        if (st.status !== 'running') break;
      }
    }
    log('DONE');
  }
  run().catch(e => log('probe-crash', String(e && (e.stack || e))));
})();
