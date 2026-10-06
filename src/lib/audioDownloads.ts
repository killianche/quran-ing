/**
 * audioDownloads — загрузка аудио на устройство.
 *
 * ── Модель ────────────────────────────────────────────────────────────
 *
 * Единица работы — ЗАДАНИЕ: произвольный список аятов, которых ещё нет
 * на устройстве.  Задание собирается из чего угодно — одной суры,
 * джуза, всего Корана или одного аята — и выполняется пулом воркеров в
 * любом порядке.  Никакой «планки, до которой скачано»: состояние
 * живёт в битовой карте audioStore, где каждый аят независим.
 *
 * Порядок внутри задания всё же осмысленный — по возрастанию номера,
 * чтобы человек, скачивающий суру и одновременно её читающий, получал
 * аяты примерно в том порядке, в каком дойдёт до них глазами.  Но это
 * удобство, а не требование модели: прерви и продолжи с любого места.
 *
 * ── Кэш по воспроизведению ────────────────────────────────────────────
 *
 * `cacheAyah()` тихо кладёт на диск аят, который только что играл со
 * стрима.  Так библиотека растёт сама собой от обычного чтения, без
 * единого нажатия «скачать».  Вызывается из useAyahAudio.
 *
 * ── Почему CapacitorHttp, а не fetch ──────────────────────────────────
 *
 * Первая версия качала обычным `fetch()`, и на устройстве это НЕ
 * РАБОТАЛО ВООБЩЕ: каждая загрузка падала с «Load failed».
 * Причина — CORS.  Страница в WebView живёт на origin
 * `capacitor://localhost`, а `cdn.islamic.network` не отдаёт заголовок
 * `Access-Control-Allow-Origin` (проверено curl'ом), поэтому браузер
 * режет кросс-доменный fetch.  При этом стриминг работал и сбивал с
 * толку: медиа-элементу `<audio src>` CORS не нужен, ему хватает
 * простого GET.
 *
 * `CapacitorHttp` входит в @capacitor/core, выполняет запрос НАТИВНО —
 * то есть мимо браузерной политики происхождения — и для
 * `responseType: 'blob'` возвращает уже готовый base64.  Это заодно
 * убирает нашу собственную конвертацию: `Filesystem.writeFile` хочет
 * ровно base64.
 *
 * Альтернативы, которые отвергнуты: `Filesystem.downloadFile`
 * (deprecated с 7.1.0), отдельный плагин @capacitor/file-transfer
 * (лишняя зависимость ради того же), включение глобального патча
 * fetch через `plugins.CapacitorHttp.enabled` (подменяет window.fetch
 * во всём приложении — слишком широкий побочный эффект ради одной
 * функции).
 *
 * Параллельность 4: упираемся не в сеть, а в запись через мост
 * Capacitor, и на бюджетных Android-устройствах восемь одновременных
 * записей начинают подъедать UI-поток.
 *
 * Загрузка живёт в модуле, а не в компоненте: попап настроек можно
 * закрыть и уйти читать, задание продолжится.
 */

import type { ReciterId } from './reciters';
import { reciterById, reciterHasSurah, supportsAyahOffline, surahAudioUrl } from './reciters';
import {
  globalAyahNumber, ayahsInSurah, firstGlobalOfSurah, juzRange,
  TOTAL_AYAHS, TOTAL_SURAHS,
} from './ayahNumbering';
import {
  hasAyah, markDownloaded, ayahFilePath, isOfflineSupported, persistNow,
  downloadedCount, downloadedInSurah,
  surahFilePath, hasSurahFile, markSurahFile, unmarkSurahFile,
} from './audioStore';
import { remoteAyahAudioUrl } from './quranUtils';

/** Сколько аятов качаем одновременно. */
const CONCURRENCY = 4;

/** Что именно качаем — для подписи в интерфейсе. */
export type DownloadScope =
  | { kind: 'surah'; surah: number }
  | { kind: 'juz'; juz: number }
  | { kind: 'all' };

export type DownloadStatus = 'idle' | 'running' | 'paused' | 'error';

export type DownloadState = {
  status: DownloadStatus;
  scope: DownloadScope | null;
  /** Сколько аятов задания уже на устройстве. */
  done: number;
  /** Сколько всего в задании (только недостающие на момент старта). */
  total: number;
  /** Байт записано за текущее задание. */
  bytes: number;
  /**
   * Сколько байт всего в задании — известно только для сплошной записи суры.
   * Для поаятных заданий 0: там ход показывается числом аятов, а полный
   * размер заранее неизвестен.
   */
  bytesTotal: number;
  error: string | null;
  /**
   * Задание «весь Коран» сплошными записями: какая сура качается прямо
   * сейчас и её собственный ход в байтах (total — оценка по `surahBytes`).
   * Плеер и шторка «Суры» показывают по нему кольцо у этой суры — иначе во
   * время автозагрузки не было бы видно, «какая докачивается» (владелец
   * 2026-10-06). У остальных заданий — null.
   */
  current?: { surah: number; done: number; total: number } | null;
};

const IDLE: DownloadState = {
  status: 'idle', scope: null, done: 0, total: 0, bytes: 0, bytesTotal: 0, error: null, current: null,
};

const state = new Map<ReciterId, DownloadState>();
const cancelFlags = new Set<ReciterId>();
const listeners = new Set<() => void>();

export function subscribeDownloads(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emit() {
  listeners.forEach(fn => fn());
}

export function getDownloadState(reciter: ReciterId): DownloadState {
  return state.get(reciter) ?? IDLE;
}

function patch(reciter: ReciterId, next: Partial<DownloadState>) {
  state.set(reciter, { ...getDownloadState(reciter), ...next });
  emit();
}

// ─── Оценка размера ─────────────────────────────────────────────────────

/**
 * Средний вес аята при 64 kbps.
 *
 * Замерено по 594 mp3 Аляфаси, лежащим в пакете (суры 67–114):
 * 54.2 МБ / 594 ≈ 93.5 КБ.  Это НИЖНЯЯ оценка: в джузе Амма аяты
 * короткие, в длинных сурах заметно длиннее.  По полной длительности
 * чтения (29.5 ч при 64 kbps ≈ 850 МБ / 6236) выходит ~139 КБ —
 * берём это как более честное среднее.
 * CHECK: уточнить после первой полной загрузки на устройстве.
 */
export const AVG_AYAH_BYTES_64KBPS = 139 * 1024;

export function estimateBytes(reciter: ReciterId, ayahCount: number): number {
  const bitrateRatio = reciterById(reciter).bitrateKbps / 64;
  return AVG_AYAH_BYTES_64KBPS * bitrateRatio * ayahCount;
}

/**
 * Сколько весит сура одной записью: точно, если размер известен
 * (`surahBytes`), иначе — по среднему весу аята.
 */
export function estimateSurahBytes(reciter: ReciterId, surah: number): number {
  return reciterById(reciter).surahBytes?.[surah]
    ?? estimateBytes(reciter, ayahsInSurah(surah));
}

/**
 * Сколько осталось скачать для «всех записей» — null, если точных размеров
 * у чтеца нет: обещать человеку цифру по среднему весу аята для почти
 * гигабайта мы не готовы.
 */
export function remainingAllBytes(reciter: ReciterId): number | null {
  const sizes = reciterById(reciter).surahBytes;
  if (!sizes) return null;
  let n = 0;
  for (const [surah, bytes] of Object.entries(sizes)) {
    if (!hasSurahFile(reciter, Number(surah))) n += bytes;
  }
  return n;
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} ГБ`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} МБ`;
  return `${Math.round(n / 1024)} КБ`;
}

// ─── Разворачивание scope в список аятов ────────────────────────────────

/** Все пары (сура, аят) диапазона сквозных номеров. */
function ayahsInGlobalRange(from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (let surah = 1; surah <= TOTAL_SURAHS; surah++) {
    const first = firstGlobalOfSurah(surah);
    const count = ayahsInSurah(surah);
    const last = first + count - 1;
    if (last < from || first > to) continue;
    for (let a = 1; a <= count; a++) {
      const g = first + a - 1;
      if (g >= from && g <= to) out.push([surah, a]);
    }
  }
  return out;
}

/**
 * Развёрнутый список всех аятов в приоритетном порядке.
 *
 * Список статичен, а строился он заново на каждый вызов expandScope —
 * включая вызовы из рендера карточки загрузок.  Сортировка 6236
 * элементов компаратором со сквозной нумерацией стоила ~9 мс на
 * ноутбуке и в разы больше на телефоне; при активной загрузке это
 * складывалось в постоянный фриз интерфейса.  Считаем один раз.
 */
let cachedAll: [number, number][] | null = null;
function allAyahsPrioritised(): [number, number][] {
  if (!cachedAll) {
    cachedAll = prioritiseForFullDownload(ayahsInGlobalRange(1, TOTAL_AYAHS));
  }
  return cachedAll;
}

function expandScope(scope: DownloadScope): [number, number][] {
  if (scope.kind === 'surah') {
    const count = ayahsInSurah(scope.surah);
    return Array.from({ length: count }, (_, i) => [scope.surah, i + 1] as [number, number]);
  }
  if (scope.kind === 'juz') {
    const [from, to] = juzRange(scope.juz);
    return ayahsInGlobalRange(from, to);
  }
  return allAyahsPrioritised();
}

/**
 * Порядок для загрузки всего Корана.
 *
 * Полный чтец при 64 kbps весит ~850 МБ и качается десятки минут.
 * Качать его подряд с Аль-Фатихи и Бакары значит, что первые полчаса
 * офлайн не работает ровно то, что читают чаще всего: короткие суры
 * джуза Амма и Аль-Фатиха в намазе.
 *
 * Поэтому впереди Аль-Фатиха и весь 30-й джуз — это ~10 % объёма,
 * приезжает за пару минут и закрывает большинство повседневных
 * сценариев.  Остальное подтягивается следом обычным порядком.
 *
 * На саму модель это не влияет: очередь — просто список, порядок в
 * ней вопрос удобства, а не корректности.
 */
function prioritiseForFullDownload(all: [number, number][]): [number, number][] {
  const [juz30From] = juzRange(30);
  const rank = ([surah, ayah]: [number, number]): number => {
    if (surah === 1) return 0;                                   // Аль-Фатиха
    if (globalAyahNumber(surah, ayah) >= juz30From) return 1;    // джуз Амма
    return 2;                                                    // всё прочее
  };
  return [...all].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return globalAyahNumber(a[0], a[1]) - globalAyahNumber(b[0], b[1]);
  });
}

/**
 * Какие суры ещё нужно скачать и в каком порядке.
 *
 * Отдельной чистой функцией, потому что ошибка здесь не видна: задание
 * просто качает не то или не в том порядке, а выглядит рабочим. Сперва
 * Аль-Фатиха, затем джуз Амма — то, что читают каждый день, приезжает
 * первым; остальное следом по номеру.
 */
export function fullDownloadSurahOrder(есть: (сура: number) => boolean): number[] {
  const [juz30From] = juzRange(30);
  const вес = (сура: number) => сура === 1
    ? 0
    : (firstGlobalOfSurah(сура) >= juz30From ? 1 : 2);
  const остались: number[] = [];
  for (let s = 1; s <= TOTAL_SURAHS; s++) if (!есть(s)) остались.push(s);
  return остались.sort((a, b) => вес(a) - вес(b) || a - b);
}

/**
 * Сколько аятов области ещё нет на устройстве.
 *
 * Для всего Корана и для суры считаем по счётчикам битовой карты, не
 * разворачивая список: функция зовётся из рендера, а разворачивание
 * 6236 пар там обходилось дороже самой отрисовки.
 *
 * ⚠️ После перехода фонотеки на сплошные записи (06.09.2026) снаружи не
 * зовётся: выбор режима воспроизведения больше не зависит от поаятного
 * покрытия. Осталась счётчиком поаятного пути — он живёт для чтецов без
 * сплошной записи и как аварийный источник.
 */
export function missingCount(reciter: ReciterId, scope: DownloadScope): number {
  if (scope.kind === 'all') {
    return TOTAL_AYAHS - downloadedCount(reciter);
  }
  if (scope.kind === 'surah') {
    return ayahsInSurah(scope.surah) - downloadedInSurah(reciter, scope.surah);
  }
  let n = 0;
  for (const [s, a] of expandScope(scope)) {
    if (!hasAyah(reciter, globalAyahNumber(s, a))) n++;
  }
  return n;
}

// ─── Скачивание одного аята ─────────────────────────────────────────────

/** URL аята у CDN — тот же, что использует стриминг. */
function cdnUrl(reciter: ReciterId, surah: number, ayah: number): string {
  return remoteAyahAudioUrl(surah, ayah, reciter);
}

/** Длина исходных данных по длине base64 — чтобы не декодировать
 *  строку обратно только ради счётчика байт. */
function base64ByteLength(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, (b64.length * 3) / 4 - padding);
}

/** Скачать и записать один аят.  Возвращает размер в байтах. */
async function fetchAndStore(reciter: ReciterId, surah: number, ayah: number): Promise<number> {
  const [{ CapacitorHttp }, { Filesystem, Directory }] = await Promise.all([
    import('@capacitor/core'),
    import('@capacitor/filesystem'),
  ]);

  const res = await CapacitorHttp.request({
    url: cdnUrl(reciter, surah, ayah),
    method: 'GET',
    // 'blob' на нативной платформе возвращает base64-строку — именно
    // то, что принимает Filesystem.writeFile.
    responseType: 'blob',
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${surah}:${ayah} — HTTP ${res.status}`);
  }
  const data = res.data;
  if (typeof data !== 'string' || data.length === 0) {
    throw new Error(`${surah}:${ayah} — пустой ответ`);
  }

  await Filesystem.writeFile({
    directory: Directory.LibraryNoCloud,
    path: ayahFilePath(reciter, surah, ayah),
    data,
    recursive: true,
  });
  markDownloaded(reciter, surah, ayah);
  return base64ByteLength(data);
}

/**
 * Тихо положить аят на диск, если его там ещё нет.
 *
 * Вызывается после успешного воспроизведения со стрима: библиотека
 * растёт от обычного чтения.  Ошибки проглатываются — это фоновая
 * любезность, а не операция, о провале которой стоит сообщать.
 */
export function cacheAyah(reciter: ReciterId, surah: number, ayah: number): void {
  if (!isOfflineSupported()) return;
  if (!supportsAyahOffline(reciter)) return;
  if (hasAyah(reciter, globalAyahNumber(surah, ayah))) return;
  void fetchAndStore(reciter, surah, ayah).catch(() => { /* не мешаем чтению */ });
}


// ─── Сплошная запись суры ───────────────────────────────────────────────

/**
 * Размер куска при загрузке сплошной записи.
 *
 * Файл суры бывает большим — у Аль-Бакары 110 МБ. Целиком его тянуть нельзя:
 * `CapacitorHttp` возвращает тело в base64, и такая строка заняла бы около
 * 147 МБ в памяти. Поэтому качаем кусками и дописываем в файл: в памяти
 * одновременно живёт один кусок.
 *
 * 4 МБ — компромисс: меньше кусков (меньше обращений через мост Capacitor),
 * но пик памяти около 5.5 МБ в base64, что телефон переносит спокойно.
 */
const SURAH_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * Скачать суру ОДНИМ файлом — той же сплошной записью, что играет из сети.
 *
 * ── Зачем это вообще ──────────────────────────────────────────────────
 *
 * Поаятные файлы удобны для докачки, но играть суру подряд из них можно
 * только подменяя аудиоэлемент на каждой границе — и это слышно. Замеряли:
 * 31 мс до правки, 10 мс после. Владелец попросил, чтобы швов не было вовсе.
 *
 * Со сплошной записью швов нет ПО ПОСТРОЕНИЮ: это тот же файл, что играет из
 * сети, поэтому офлайн идёт ровно тем же путём и с теми же таймингами аятов.
 * Переключать нечего.
 *
 * ── Почему кусками, а не целиком ──────────────────────────────────────
 *
 * `Filesystem.downloadFile` объявлен устаревшим, отдельный плагин брать не
 * стали (см. шапку модуля), а `CapacitorHttp` отдаёт тело base64-строкой —
 * для 110 МБ это неприемлемо. Куски по 4 МБ решают и то, и другое: хосты
 * отвечают на частичные запросы (проверено, код 206), а `appendFile`
 * дописывает каждый кусок к файлу.
 *
 * ── Докачка ───────────────────────────────────────────────────────────
 *
 * Если файл уже частично лежит, продолжаем с его длины. Прерванная загрузка
 * не начинается заново — это важно на телефоне, где сеть пропадает.
 */
export async function downloadSurahFile(
  reciter: ReciterId,
  surah: number,
  onProgress?: (готово: number, всего: number) => void,
): Promise<boolean> {
  if (!isOfflineSupported()) return false;
  if (hasSurahFile(reciter, surah)) return true;
  // Суры, которой у чтеца нет, на сервере нет тоже — не ходим за 404.
  if (!reciterHasSurah(reciter, surah)) return false;

  const url = surahAudioUrl(reciter, surah);
  if (!url) return false;

  const [{ CapacitorHttp }, { Filesystem, Directory }] = await Promise.all([
    import('@capacitor/core'),
    import('@capacitor/filesystem'),
  ]);
  const path = surahFilePath(reciter, surah);

  // Сколько уже лежит: продолжаем с этого места.
  let готово = 0;
  try {
    const stat = await Filesystem.stat({ directory: Directory.LibraryNoCloud, path });
    готово = typeof stat.size === 'number' ? stat.size : 0;
  } catch {
    готово = 0;                                   // файла ещё нет — начинаем с нуля
  }

  // Общий размер узнаём из заголовка ответа на первый частичный запрос:
  // `Content-Range: bytes 0-0/12345678`. Отдельный HEAD не делаем — лишний
  // обход сети, а некоторые хосты на HEAD отвечают иначе, чем на GET.
  const проба = await CapacitorHttp.request({
    url, method: 'GET', responseType: 'blob',
    headers: { Range: 'bytes=0-0' },
  });
  const contentRange = String(
    проба.headers?.['Content-Range'] ?? проба.headers?.['content-range'] ?? '');
  const всего = Number(contentRange.split('/')[1]);
  if (!Number.isFinite(всего) || всего <= 0) {
    // Хост не поддерживает частичные запросы — честно отступаем, а не тянем
    // 110 МБ в память.
    return false;
  }

  // На диске больше, чем весит файл на сервере, — значит лежит мусор: склейка
  // после ответа 200, остаток от другого битрейта, обрывок чужой версии. Такой
  // файл не «уже скачан», его надо начать заново, иначе объявим полным битое.
  if (готово > всего) {
    await Filesystem.deleteFile({ directory: Directory.LibraryNoCloud, path })
      .catch(() => { /* могло не быть */ });
    готово = 0;
  }

  while (готово < всего) {
    // Пауза обязана срабатывать между кусками: иначе человек, увидевший
    // объём в сотню мегабайт, жмёт «Паузу» и ничего не происходит — загрузка
    // идёт до конца, а состояние в интерфейсе не меняется.
    if (cancelFlags.has(reciter)) return false;

    const до = Math.min(готово + SURAH_CHUNK_BYTES, всего) - 1;
    const res = await CapacitorHttp.request({
      url, method: 'GET', responseType: 'blob',
      headers: { Range: `bytes=${готово}-${до}` },
    });
    // Только 206. Ответ 200 означает, что сервер прислал ВЕСЬ файл, не поняв
    // заголовка Range: дописать такое к уже лежащим байтам — испортить файл
    // молча. Честно отступаем на поаятный путь.
    if (res.status !== 206) {
      if (готово === 0) return false;
      throw new Error(`сура ${surah}: сервер перестал отдавать частями (HTTP ${res.status})`);
    }
    const data = res.data;
    if (typeof data !== 'string' || data.length === 0) {
      throw new Error(`сура ${surah}: пустой кусок`);
    }
    if (готово === 0) {
      await Filesystem.writeFile({
        directory: Directory.LibraryNoCloud, path, data, recursive: true,
      });
    } else {
      await Filesystem.appendFile({
        directory: Directory.LibraryNoCloud, path, data,
      });
    }
    готово += base64ByteLength(data);
    onProgress?.(готово, всего);
  }

  markSurahFile(reciter, surah);
  await persistNow();
  return true;
}

/** Снять отметку и удалить недокачанное — если загрузка сорвалась. */
export async function discardSurahFile(reciter: ReciterId, surah: number): Promise<void> {
  unmarkSurahFile(reciter, surah);
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.deleteFile({
      directory: Directory.LibraryNoCloud, path: surahFilePath(reciter, surah),
    });
  } catch {
    // Файла могло не быть — не ошибка.
  }
}

// ─── Задания ────────────────────────────────────────────────────────────

/**
 * Запустить (или продолжить) загрузку области.
 *
 * Повторный вызов после паузы просто пересобирает список недостающих —
 * поэтому докачка не требует ни курсора, ни отдельного кода
 * возобновления.
 */
export async function startDownload(reciter: ReciterId, scope: DownloadScope): Promise<void> {
  if (!isOfflineSupported()) {
    patch(reciter, {
      status: 'error',
      error: 'Скачивание доступно только в приложении для iOS и Android.',
    });
    return;
  }
  if (!supportsAyahOffline(reciter) && !surahAudioUrl(reciter, 1)) {
    patch(reciter, {
      status: 'error',
      error: 'Для этого чтеца пока доступно только потоковое воспроизведение.',
    });
    return;
  }
  if (getDownloadState(reciter).status === 'running') return;

  cancelFlags.delete(reciter);

  // 🔴 Одну суру качаем ОДНИМ файлом, а не сотней кусочков.
  //
  // Поаятные файлы играются подряд только подменой аудиоэлемента на каждой
  // границе, и это слышно: замеряли 31 мс до правки, 10 мс после. Владелец
  // попросил, чтобы швов не было вовсе. Сплошная запись — тот же файл, что
  // играет из сети, поэтому офлайн идёт тем же путём и с теми же таймингами:
  // переключать нечего, шва нет по построению.
  //
  // Если хост не отдаёт файл частями или чтец без сплошной записи —
  // `downloadSurahFile` честно возвращает false, и мы спокойно уходим на
  // прежний поаятный путь, а не остаёмся без звука.
  if (scope.kind === 'surah') {
    patch(reciter, { status: 'running', scope, done: 0, total: 1, bytes: 0, error: null });
    try {
      const готово = await downloadSurahFile(reciter, scope.surah, (сделано, всего) => {
        // Ход показываем БАЙТАМИ: сура качается одним файлом, и «0 из 1»
        // означало бы прыжок с нуля сразу в конец на сотне мегабайт.
        patch(reciter, { done: сделано >= всего ? 1 : 0, total: 1, bytes: сделано, bytesTotal: всего });
      });
      if (готово) {
        patch(reciter, { ...IDLE, scope, done: 1, total: 1 });
        return;
      }
      // 🔴 У чтеца только целыми сурами (Хьусейн Мержоев) отступать некуда.
      //
      // Поаятный путь здесь хуже, чем бесполезен: `remoteAyahAudioUrl` у
      // такого чтеца отдаёт адрес файла ВСЕЙ суры, и очередь скачала бы его
      // столько раз, сколько в суре аятов — Аль-Бакару 286 раз по 116 МБ,
      // около 33 ГБ трафика и места (поймано ревью коммита 2008515).
      if (!supportsAyahOffline(reciter)) {
        if (cancelFlags.has(reciter)) {
          cancelFlags.delete(reciter);
          patch(reciter, { status: 'paused', scope });
          return;
        }
        patch(reciter, {
          status: 'error', scope, done: 0, total: 1,
          error: reciterHasSurah(reciter, scope.surah)
            ? 'Не удалось скачать суру — попробуйте позже. Она продолжит играть через интернет.'
            : 'У этого чтеца пока нет записи этой суры.',
        });
        return;
      }
    } catch (error) {
      // 🔴 Частично скачанное НЕ стираем.
      //
      // Первая редакция звала здесь `discardSurahFile` на любую ошибку. На
      // нестабильной сети это означало: 100 МБ из 110 скачано, лифт — и всё
      // удалено, следующая попытка с нуля. Длинная сура не скачалась бы
      // никогда, а трафик тратился бы заново каждый раз.
      //
      // Файл — это и есть точка докачки, поэтому при обрыве оставляем его и
      // показываем паузу. Удалять есть смысл только когда содержимое
      // непригодно (см. `downloadSurahFile`: там файл начинается заново, если
      // на диске оказалось больше ожидаемого).
      patch(reciter, {
        status: 'paused', scope,
        error: `Загрузка прервана: ${String(error).slice(0, 60)}. Нажмите «Скачать», чтобы продолжить.`,
      });
      return;
    }
  }

  // 🔴 Вся фонотека — СПЛОШНЫМИ записями сур, а не 6236 кусочками.
  //
  // Прежде «скачать всё» тянуло отдельный файл на каждый аят. Это работало и
  // давало обратный эффект: собранная поаятная сура заставляла плеер играть
  // её же поаятно, со швом на каждой границе (см. `useAyahAudio`, выбор
  // режима). То есть чем полнее становилась офлайн-библиотека, тем хуже
  // звучало чтение — и это происходило само, на Wi-Fi, без единого действия
  // человека.
  //
  // Теперь скачивается ровно то, что играет: 114 непрерывных файлов. Путь
  // один и тот же онлайн и офлайн, значит швов нет по построению.
  //
  // Порядок тот же, что и был у поаятной очереди: сперва Аль-Фатиха, потом
  // джуз Амма — то, что читают каждый день, приезжает первым.
  if (scope.kind === 'all' && surahAudioUrl(reciter, 1)) {
    // Суры, которых у чтеца нет вовсе (`availableSurahs`), качать нечего:
    // без этого задание вечно стояло бы на «80 из 114» и на каждом
    // «Докачать» ходило бы за 34 несуществующими файлами.
    const остались = fullDownloadSurahOrder(
      s => hasSurahFile(reciter, s) || !reciterHasSurah(reciter, s),
    );

    if (остались.length === 0) {
      patch(reciter, { ...IDLE, scope });
      return;
    }

    // Полный объём задания — только когда размеры файлов известны точно
    // (`surahBytes`): по нему интерфейс показывает «осталось N МБ», и
    // цифра обязана убывать вместе с загрузкой, а не стоять до конца суры.
    // Частично лежащий файл в `bytes` уже учтён: прогресс суры начинается с
    // его длины.
    const точно = reciterById(reciter).surahBytes != null;
    patch(reciter, {
      status: 'running', scope, done: 0, total: остались.length,
      bytes: 0,
      bytesTotal: точно ? остались.reduce((n, сура) => n + estimateSurahBytes(reciter, сура), 0) : 0,
      error: null,
    });

    let готовых = 0;
    let пропущено = 0;
    let байтовРанее = 0;
    for (const сура of остались) {
      if (cancelFlags.has(reciter)) {
        cancelFlags.delete(reciter);
        patch(reciter, { status: 'paused', done: готовых, bytes: байтовРанее });
        return;
      }
      try {
        // Байты копим по всему заданию: полоса не должна дёргаться назад на
        // каждой новой суре. Полный размер задания заранее неизвестен —
        // сколько весит сура, хост сообщает только в ответе на первый кусок.
        const весСуры = estimateSurahBytes(reciter, сура);
        patch(reciter, { current: { surah: сура, done: 0, total: весСуры } });
        const ok = await downloadSurahFile(reciter, сура, (сделано) => {
          patch(reciter, {
            bytes: байтовРанее + сделано,
            current: { surah: сура, done: сделано, total: весСуры },
          });
        });
        // 🔴 Отказ и пауза различаются, иначе задание врёт.
        //
        // `downloadSurahFile` возвращает false и когда записи нет, и когда
        // человек нажал «Паузу» посреди файла. Считать оба «пропуском»
        // нельзя: при паузе полоса откатывалась к последнему целому файлу, а
        // если пауза приходилась на последнюю суру списка — задание
        // завершалось как успешное. Ревью поймало это до выпуска.
        if (cancelFlags.has(reciter)) {
          cancelFlags.delete(reciter);
          patch(reciter, {
            status: 'paused', done: готовых, bytes: getDownloadState(reciter).bytes,
          });
          return;
        }
        if (!ok) {
          // Сплошной записи для этой суры нет — пропускаем, не роняя задание.
          // Такая сура останется потоковой.
          пропущено++;
          continue;
        }
        байтовРанее = getDownloadState(reciter).bytes;
        готовых++;
        patch(reciter, { done: готовых });
      } catch (error) {
        // Частично скачанный файл остаётся точкой докачки — не стираем.
        patch(reciter, {
          status: 'paused', scope, done: готовых, bytes: байтовРанее,
          error: `Загрузка прервана: ${String(error).slice(0, 60)}. Нажмите «Скачать», чтобы продолжить.`,
        });
        return;
      }
    }

    // 🔴 Задание, не скачавшее НИЧЕГО, — это отказ, а не успех.
    //
    // Прежде такой проход возвращал `idle`, и карточка показывала «Не
    // скачано — играет стримом»: нажатие на кнопку выглядело неработающим.
    // Так и будет, если хост перестанет отвечать на частичные запросы.
    if (готовых === 0 && пропущено > 0) {
      patch(reciter, {
        status: 'error', scope, done: 0, total: остались.length,
        error: 'Не удалось скачать ни одной суры: источник не отдаёт записи частями. Чтение продолжит работать через интернет.',
      });
      return;
    }

    patch(reciter, { ...IDLE, scope, done: готовых, total: остались.length });
    return;
  }

  // Последний рубеж: поаятная очередь у чтеца без поаятного источника
  // скачивала бы файл целой суры на каждый аят (см. ветку суры выше).
  if (!supportsAyahOffline(reciter)) {
    patch(reciter, {
      status: 'error', scope,
      error: 'Этого чтеца можно скачать только целыми сурами.',
    });
    return;
  }

  const targets = expandScope(scope)
    .filter(([s, a]) => !hasAyah(reciter, globalAyahNumber(s, a)));

  if (targets.length === 0) {
    patch(reciter, { ...IDLE, scope });
    return;
  }

  patch(reciter, {
    status: 'running', scope, done: 0, total: targets.length, bytes: 0, error: null,
  });

  let done = 0;
  let bytes = 0;
  let failed: string | null = null;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      if (cancelFlags.has(reciter) || failed) return;
      const i = cursor++;
      if (i >= targets.length) return;
      const [surah, ayah] = targets[i];
      try {
        bytes += await fetchAndStore(reciter, surah, ayah);
        done++;
        patch(reciter, { done, bytes });
      } catch (e) {
        failed = e instanceof Error ? e.message : 'ошибка загрузки';
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await persistNow();

  if (cancelFlags.has(reciter)) {
    cancelFlags.delete(reciter);
    patch(reciter, { status: 'paused', done, bytes });
  } else if (failed) {
    patch(reciter, { status: 'error', done, bytes, error: failed });
  } else {
    patch(reciter, { ...IDLE, scope });
  }
}

/** Остановить.  Скачанное остаётся, повторный запуск доберёт остальное. */
export function pauseDownload(reciter: ReciterId): void {
  if (getDownloadState(reciter).status !== 'running') return;
  cancelFlags.add(reciter);
}

/** Сбросить состояние задания в интерфейсе (после удаления, например). */
export function resetDownloadState(reciter: ReciterId): void {
  cancelFlags.delete(reciter);
  state.set(reciter, IDLE);
  emit();
}
