import { useState, useRef, useCallback, useEffect } from 'react';
import { ayahAudioUrl } from '../lib/quranUtils';
import { ayahAudioRange } from '../lib/ayahAudioRange';
import { localAyahSrc, localSurahSrc, unmarkSurahFile } from '../lib/audioStore';
import {
  DEFAULT_RECITER, RECITERS_WITH_SEGMENTS, TIMELINE_SEEK_STEP_SECONDS, hasSurahAudio,
  nextAvailableSurah, reciterHasSurah, requiresSurahAudioStream, surahAudioUrl,
  usesTimelineSeek, type ReciterId,
} from '../lib/reciters';
import {
  setMediaSessionMetadata, setMediaSessionPlaybackState,
  setMediaSessionPosition, clearMediaSessionMetadata,
} from '../lib/mediaSession';
import { SURAH_BY_NUMBER } from '../content/surahs';
import { RECOVERY_PROBE_TIMEOUT_MS, recoveryDelayMs } from '../lib/audioRecovery';

// Lazy-import: quran-segments.ts ~4 МБ.  Раньше sync-импорт тащил
// в main bundle всю карту word-timings 8 чтецов × 6236 аятов.  Теперь
// модуль грузится только при ПЕРВОМ воспроизведении аята — пока промис
// не разрешён, word-маркер просто не двигается (приемлемая деградация
// на 100-300 мс).  Один промис на всё время жизни приложения.
type SegmentsModule = typeof import('../content/quran-segments');
let segmentsModulePromise: Promise<SegmentsModule> | null = null;
let segmentsModuleCached: SegmentsModule | null = null;
function loadSegmentsModule(): Promise<SegmentsModule> {
  if (!segmentsModulePromise) {
    segmentsModulePromise = import('../content/quran-segments').then(m => {
      segmentsModuleCached = m;
      return m;
    });
  }
  return segmentsModulePromise;
}

type AudioState = 'idle' | 'loading' | 'playing' | 'paused';

/** Allowed playback rates — cycled by the BottomDock pill.  Default
 *  is 1.0; the slower 0.75 sits first so a tap from default goes
 *  faster (more common need) rather than slower. */
export const PLAYBACK_RATES = [0.75, 1.0, 1.25] as const;
/** Отказ воспроизведения, о котором надо сказать вслух. */
export type AudioFailure = {
  surah: number;
  ayah: number;
  lastAyah: number;
  /** Где оборвалось, секунды записи — у чтеца без границ аятов, где «аят»
   *  ничего не говорит. Повтор продолжает отсюда, а не с начала суры. */
  positionSeconds?: number;
  /** Устройство сообщает, что сети нет вовсе. */
  offline: boolean;
  /** Не сбой, а отсутствие: у чтеца нет записи этой суры
   *  (`availableSurahs`). Повторять нечего. */
  unavailable?: true;
};

export type PlaybackRate = typeof PLAYBACK_RATES[number];

const KEY_PLAYBACK_RATE = 'audio.playbackRate';

function readStoredRate(): PlaybackRate {
  const v = parseFloat(localStorage.getItem(KEY_PLAYBACK_RATE) ?? '1.0');
  return (PLAYBACK_RATES as readonly number[]).includes(v) ? (v as PlaybackRate) : 1.0;
}

/** Cache keyed by `${reciter}:${surah}:${ayah}` so reciter changes
 *  don't collide.  Реализован как LRU (Map сохраняет порядок вставки),
 *  максимум AUDIO_CACHE_MAX элементов.  Без верхней границы iOS Safari
 *  WebView начинает терять аудио-декодеры после ~40-50 элементов
 *  (HTMLAudioElement держит ссылку на raw audio buffer; iOS WebView
 *  имеет жёсткий лимит ~75 одновременных audio decoders).
 *  6 = текущий аят + prefetch вперёд + небольшой запас.
 *
 *  🔴 Для непрерывных записей суры предел свой и меньше. Шесть коротких
 *  файлов аята — это единицы мегабайт; шесть полных сур — это шесть
 *  многоминутных потоков, которые WKWebView держит целиком. Больше двух
 *  (текущая сура и соседняя) там не нужно ни для чего. */
const AUDIO_CACHE_MAX = 6;
const CONTINUOUS_CACHE_MAX = 2;
/**
 * За сколько до конца файла аята начинать переход к следующему.
 *
 * Меньше — разрыв заметнее; больше — дольше звучат оба файла разом. 50 мс
 * подобраны по замеру: типичный разрыв был 15–56 мс, и этого хватает, чтобы
 * его закрыть, оставаясь в пределах затухающего хвоста записи.
 */
const EARLY_ADVANCE_SECONDS = 0.05;

/**
 * За сколько секунд до конца записи прогревать файл следующей суры.
 *
 * При «слушать суру целиком» следующая сура — новый файл, и без прогрева он
 * начинал грузиться только в момент перехода. Замер 13.09.2026 на быстром
 * сервере: 88–128 мс, когда не играл ни один элемент. На мобильной сети —
 * дольше, а в фоне iOS разрешает запуск звука, только пока страница уже
 * что-то играет: в эту тишину следующая сура так и не стартовала.
 * Тридцать секунд хватает, чтобы набрать буфер и на медленной сети.
 */
const PREWARM_NEXT_SURAH_SECONDS = 30;

const audioCache = new Map<string, HTMLAudioElement>();
const logicalKeyForAudio = new WeakMap<HTMLAudioElement, string>();
const completedRange = new WeakSet<HTMLAudioElement>();
/**
 * Элементы, которым РАЗРЕШЕНО доиграть хвост.
 *
 * При раннем переходе следующий аят запускается за 50 мс до конца текущего.
 * Без этой пометки общий цикл в `playOne` остановил бы уходящий элемент и
 * перемотал его в ноль — то есть срезал последние 50 мс чтения. Ревью
 * поймало это в диффе; замер поймать не мог: разрыв он показывал коротким
 * именно потому, что хвост обрубался.
 */
const finishingTail = new WeakSet<HTMLAudioElement>();

/**
 * Элементы, которым уже давали второй шанс.
 *
 * Сплошная запись играет из сети, поэтому обычный обрыв связи стал стоить
 * дороже, чем раньше: молчание вместо звука. Одна повторная попытка того же
 * адреса закрывает случайную осечку (переезд между вышками, секундный провал
 * Wi-Fi), а бесконечно долбиться в мёртвую сеть нельзя — поэтому шанс ровно
 * один на элемент.
 */
const retriedOnce = new WeakSet<HTMLAudioElement>();

/** Пауза перед повторной попыткой. */
const RETRY_DELAY_MS = 900;

/**
 * Сколько ждать первого звука, прежде чем считать источник мёртвым.
 *
 * 🔴 Это не перестраховка, а починка настоящего отказа. Медиаэлемент при
 * мёртвом соединении (captive portal в отеле, тоннель, «полоска есть, данных
 * нет») НЕ бросает `error` — он молча стоит в `stalled`. Значит обработчик
 * ошибки не вызовется никогда, и человек получит вечную «загрузку» с
 * заблокированной кнопкой паузы. Ревью поймало это до выпуска.
 *
 * Пять секунд: меньше — сорвём медленную, но живую сотовую сеть; больше —
 * человек успеет решить, что приложение сломалось.
 */
const STALL_TIMEOUT_MS = 5000;

/**
 * То же, но для обрыва ПОСРЕДИ чтения (`waiting`).
 *
 * Дольше, чем на старте: здесь звук уже шёл, человек слушает, и оборвать
 * чтение из-за восьмисекундной ямы на слабой сотовой сети хуже, чем подождать.
 */
const MIDSTREAM_STALL_MS = 8000;

function touchCache(key: string, audio: HTMLAudioElement) {
  // LRU touch: удалить старую запись чтобы переместить в end (Map
  // сохраняет insertion order), потом вставить заново.
  if (audioCache.has(key)) audioCache.delete(key);
  audioCache.set(key, audio);
  // Эвикция самых старых записей если перебор по размеру.
  // Непрерывные записи вытесняем отдельно и раньше: ключ у них кончается
  // на `:surah` (см. mediaCacheKey).
  //
  // 🔴 Звучащую запись и доигрывающий хвост не выселяем никогда. Раньше
  // безопасность держалась на порядке касаний: выселялась «самая старая», и
  // это случайно не была текущая. С прогревом следующей суры в кэше
  // оказываются сразу текущая и следующая — выселение звучащей оборвало бы
  // чтение посреди аята. Если лишним оказывается только звучащее, кэш
  // временно больше предела на один элемент — это дешевле тишины.
  const звучит = (el: HTMLAudioElement | undefined) =>
    !!el && (!el.paused || finishingTail.has(el));
  const continuous = [...audioCache.keys()].filter(k => k.endsWith(':surah'));
  let лишнихСплошных = continuous.length - CONTINUOUS_CACHE_MAX;
  for (const k of continuous) {
    if (лишнихСплошных <= 0) break;
    if (k === key) continue;
    const el = audioCache.get(k);
    if (звучит(el)) continue;
    if (el) {
      el.onended = null;
      el.onerror = null;
      el.onwaiting = null;
      el.onplaying = null;
      el.pause(); el.removeAttribute('src'); el.load();
    }
    audioCache.delete(k);
    лишнихСплошных--;
  }
  let лишних = audioCache.size - AUDIO_CACHE_MAX;
  for (const k of [...audioCache.keys()]) {
    if (лишних <= 0) break;
    if (k === key) continue;
    const oldest = audioCache.get(k);
    if (звучит(oldest)) continue;
    if (oldest) {
      // 🔴 Сначала снимаем обработчики, потом источник. `src = ''` WebKit
      // считает негодным адресом и шлёт `error`, а обработчик выселяемого
      // аята — это `failAndStop` его давно закончившегося воспроизведения.
      // Замер в симуляторе iOS 13.09.2026: в поаятном режиме на каждом аяте
      // приходил ложный «playback failed» от аята шестью раньше. Обработчик
      // уходил на проверке активного элемента, но полагаться на это нельзя.
      oldest.onended = null;
      oldest.onerror = null;
      oldest.onwaiting = null;
      oldest.onplaying = null;
      try { oldest.pause(); oldest.removeAttribute('src'); oldest.load(); }
      catch { /* устаревший element может уже быть detached — игнор */ }
    }
    audioCache.delete(k);
    лишних--;
  }
}

/**
 * Этот аят — последний перед переходом в следующую суру.
 *
 * Только при «слушать суру целиком» (`startedWholeSurah`): тап по одному
 * аяту по-прежнему останавливается на конце суры — так решил владелец
 * 09.09.2026.
 */
function уходитВСледующуюСуру(
  q: { surah: number; last: number } | null,
  surah: number,
  ayah: number,
  reciter: ReciterId,
): boolean {
  if (!startedWholeSurah || !q || q.surah !== surah) return false;
  const конец = Math.min(q.last, SURAH_BY_NUMBER[surah]?.ayahs ?? q.last);
  // «Следующая» — следующая, которая ЕСТЬ у чтеца: у Мержоева после 9-й
  // идёт 12-я, а не несуществующая запись 10-й.
  return ayah >= конец && nextAvailableSurah(reciter, surah) !== null;
}

/** Прогретые элементы — чтобы не звать `load()` на каждом кадре. */
const прогретые = new WeakSet<HTMLAudioElement>();

/** Заранее начать грузить файл следующей суры, чтобы переход был мгновенным. */
function прогретьСуру(surah: number, reciter: ReciterId) {
  if (!usesContinuousAudio(reciter)) return;
  const a = getOrCreateAudio(mediaCacheKey(reciter, surah, 1), surah, 1, reciter);
  if (прогретые.has(a)) return;
  прогретые.add(a);
  a.preload = 'auto';
  try { a.load(); } catch { /* элемент мог быть отцеплен — прогрев не критичен */ }
}

function cacheKey(reciter: ReciterId, surah: number, ayah: number) {
  return `${reciter}:${surah}:${ayah}`;
}

/**
 * Режим текущей сессии воспроизведения.
 *
 * `surah` — читаем непрерывную запись суры. Склейка из поаятных файлов даёт
 * слышимую паузу на каждой границе: она не в записи, а в запуске нового
 * аудиоэлемента. Сейчас этот режим берётся и когда человек ткнул в отдельный
 * аят, потому что у тапа есть продолжение — очередь идёт до конца суры.
 *
 * `ayah` — короткие файлы отдельных аятов. Остался для одного случая:
 * полностью скачанная сура, где локальные файлы дают звук без сети.
 *
 * ── Почему «большой файл» оказался не дороже ──────────────────────────
 *
 * Прежняя редакция этого комментария утверждала, что тап в середине
 * Аль-Бакары «открывал бы 100+ МБ ради одного seek», и ради этого держала
 * поаятный режим. Замерили: файл действительно 110 МБ, но хосты отвечают на
 * частичные запросы (206), и браузеру для старта нужен только нужный кусок.
 * Тап по 127-му аяту (перемотка на 45-ю минуту): новая схема 431/468/633 мс,
 * старая на тех же прогонах 534/571/491 мс. То есть размер файла на скорость
 * старта не влияет вовсе. Опасение было верным по смыслу и неверным по факту
 * — проверяйте замером, прежде чем возвращать поаятный режим ради скорости.
 *
 * Флаг модульный, а не в состоянии хука: звучащая сессия в приложении одна,
 * а решение о режиме нужно шести местам ниже по коду, включая ключ кэша
 * элементов. Протаскивать его параметром через все шесть значило бы
 * менять сигнатуры ради того, что и так глобально по смыслу.
 */
export type PlaybackMode = 'ayah' | 'surah';
let playbackMode: PlaybackMode = 'ayah';

/**
 * Включили суру ЦЕЛИКОМ (кнопкой «слушать суру»), а не ткнули в первый аят.
 *
 * Отдельно от `playbackMode`, потому что после перевода ленты на сплошную
 * запись режим стал одинаковым в обоих случаях, а поведение — разное.
 * Запуск суры начинается с нуля записи, чтобы не срезать истиазу и басмалу;
 * тап по первому аяту обязан дать именно первый аят, без вступления.
 */
let startedWholeSurah = false;

function usesContinuousAudio(reciter: ReciterId) {
  if (playbackMode === 'surah' && hasSurahAudio(reciter)) return true;
  return requiresSurahAudioStream(reciter);
}

function rangeForMedia(reciter: ReciterId, surah: number, ayah: number) {
  if (usesTimelineSeek(reciter)) return null;
  return usesContinuousAudio(reciter) ? ayahAudioRange(reciter, surah, ayah) : null;
}

/**
 * Очередь чтеца без границ аятов — ровно один «аят»: вся запись суры.
 *
 * 🔴 Без этого очередь шла бы от аята к аяту, как у остальных чтецов. Но
 * без таблицы границ каждый следующий аят — это перемотка в НОЛЬ записи:
 * сура проигрывалась бы заново столько раз, сколько в ней аятов, и только
 * потом уходила бы в следующую. Логический аят здесь всегда первый, конец
 * очереди — конец файла.
 */
function timelineQueueBounds(reciter: ReciterId, fromAyah: number, lastAyah: number) {
  return usesTimelineSeek(reciter)
    ? { fromAyah: 1, lastAyah: 1 }
    : { fromAyah, lastAyah };
}

/** Continuous-only sources reuse one decoder per surah. Reciters with an
 * ayah CDN keep one short element per ayah both online and offline. */
function mediaCacheKey(reciter: ReciterId, surah: number, ayah: number) {
  return usesContinuousAudio(reciter)
    ? `${reciter}:${surah}:surah`
    : cacheKey(reciter, surah, ayah);
}

function seekAudio(audio: HTMLAudioElement, seconds: number) {
  const apply = () => {
    try { audio.currentTime = seconds; } catch { /* metadata is still unavailable */ }
  };
  apply();
  if (audio.readyState === HTMLMediaElement.HAVE_NOTHING) {
    audio.addEventListener('loadedmetadata', apply, { once: true });
  }
}

/** Build (or reuse) the <audio> for a given ayah.
 *
 * `eager` controls preload aggression:
 *   - 'eager' (default for the about-to-play element) — `preload='auto'`
 *     so the browser starts downloading bytes the moment the element
 *     is created.  Without this, .play() has to wait for the entire
 *     network round-trip before the first byte arrives, adding a
 *     noticeable "tap → silence → audio" gap on every fresh ayah.
 *   - 'lazy' (used by prefetchAyah for the NEXT ayah while the current
 *     one is playing) — `preload='auto'` too, so bytes and decoder are
 *     ready before the logical boundary. Only one neighbour is warmed,
 *     therefore this does not start downloading the rest of the surah.
 */
function getOrCreateAudio(
  key: string,
  surah: number,
  ayah: number,
  reciter: ReciterId,
  eager: 'eager' | 'lazy' = 'eager',
) {
  // Recreate if absent OR if the cached element is stuck in an error state from
  // a previous failed load (network blip, brief CDN hiccup). Reusing an errored
  // <audio> never recovers — its `error` property sticks, and `.play()` resolves
  // immediately without playing any sound, leaving the queue dead on that ayah.
  const cached = audioCache.get(key);
  if (cached && !cached.error) {
    // Bump preload up if the cached element was created lazily and we
    // now need it ready to play.  Going the other way (eager → lazy)
    // is pointless: the bytes are already in flight or in cache.
    if (eager === 'eager' && !usesContinuousAudio(reciter)
      && cached.preload !== 'auto') {
      cached.preload = 'auto';
      // Touching `load()` after a preload bump kicks the browser into
      // actually fetching — without it Safari leaves preload='auto'
      // unobserved on already-attached <audio>.
      cached.load();
    }
    // LRU touch — accessed → moved to end чтобы не выселить.
    touchCache(key, cached);
    return cached;
  }
  const a = new Audio();
  const continuous = usesContinuousAudio(reciter);
  // Полная сура может быть большой. `metadata` разрешает браузеру начать
  // поток с нужного byte-range, а последовательное чтение затем идёт тем же
  // декодером. Поаятные офлайн-файлы по-прежнему прогружаем целиком заранее.
  // `metadata` только на создание: так первый seek в середину суры не ждёт
  // лишних байт. Дальше, когда звук уже пошёл, оценка меняется на
  // противоположную — см. `подтянутьВперёд` ниже.
  a.preload = continuous ? 'metadata' : 'auto';
  // Порядок важен: сперва СПЛОШНАЯ ЗАПИСЬ НА ДИСКЕ. Это тот же файл, что
  // играет из сети, поэтому офлайн идёт тем же путём и с теми же таймингами —
  // швов на границах аятов нет по построению. Только если её нет, берём
  // сетевую сплошную, и лишь в последнюю очередь — файл отдельного аята.
  const местная = continuous ? localSurahSrc(surah, reciter) : null;
  a.src = continuous
    ? (местная ?? surahAudioUrl(reciter, surah) ?? ayahAudioUrl(surah, ayah, reciter))
    : ayahAudioUrl(surah, ayah, reciter);

  if (местная) подстраховатьМестныйФайл(a, surah, reciter);
  // Safari/WebView не всегда начинает preload сразу после присваивания src.
  a.load();
  touchCache(key, a);  // вставить + эвикция самых старых при превышении.
  return a;
}

/**
 * Отметка о скачанном файле может пережить сам файл: место кончилось,
 * система почистила кэш, запись оборвалась. Тогда элемент падает с ошибкой,
 * и без этого чтение просто останавливалось бы при живом интернете. Снимаем
 * отметку и один раз пересаживаемся на сетевой адрес.
 */
function подстраховатьМестныйФайл(a: HTMLAudioElement, surah: number, reciter: ReciterId) {
  a.addEventListener('error', () => {
    const сетевой = surahAudioUrl(reciter, surah);
    if (!сетевой || a.src === сетевой) return;
    // Запускаем снова, только если элемент уже звучал. Элемент может быть
    // создан заранее — прогревом следующей суры — и тогда безусловный
    // `play()` включил бы её поверх текущей за полминуты до конца (ревью
    // 13.09.2026).
    const играл = !a.paused;
    unmarkSurahFile(reciter, surah);
    a.src = сетевой;
    a.load();
    if (играл) void a.play().catch(() => { /* решение примет обычная обработка ошибки */ });
  }, { once: true });
}

/** Fire-and-forget: warm the cache for the NEXT ayah while the current
 *  one is playing.  When auto-advance fires, the bytes are already in
 *  the HTTP cache so the transition is gap-free. */
function prefetchAyah(surah: number, ayah: number, reciter: ReciterId) {
  const key = mediaCacheKey(reciter, surah, ayah);
  if (audioCache.has(key)) return;                         // already cached
  // 'lazy' so we don't compete with the currently-playing element for
  // bandwidth on slow connections; the browser will still pre-fetch.
  getOrCreateAudio(key, surah, ayah, reciter, 'lazy');
}

/** Stop every Quran audio element without touching React state.
 *
 * Нужен отдельно от stopAll(): cleanup размонтированного экрана не должен
 * вызывать setState, но обязан погасить общий module-level cache. Иначе при
 * смене экрана старый экран исчезает, а его HTMLAudioElement продолжает
 * читать невидимо уже под новым. */
function stopCachedAyahAudio() {
  audioCache.forEach(audio => {
    // Хвост, остановленный извне, уже не получит ни `playing` следующей
    // суры, ни собственного `ended` — без снятия пометки он навсегда
    // остался бы «доигрывающим»: его не глушил бы ручной переход и не
    // вытеснял бы кэш (ревью 13.09.2026).
    finishingTail.delete(audio);
    audio.pause();
    try { audio.currentTime = 0; } catch { /* metadata may be unavailable */ }
  });
  снятьАварийныйРежим();
  clearMediaSessionMetadata();
}

// ─── Аварийный поаятный режим — временный ───────────────────────────────
//
// Зачем и почему с растущей паузой — в шапке `src/lib/audioRecovery.ts`.
// Здесь только механика: отказ сплошной записи включает поаятный режим и
// заводит фоновую проверку; как только запись снова открывается, элемент
// проверки кладётся в кэш под ключом сплошной записи, и на ближайшей
// автоматической границе аята `вернутьсяНаСплошную` возвращает режим.

type АварийныйРежим = {
  reciter: ReciterId;
  surah: number;
  таймер: number;
  /** Элемент, на котором сплошная запись открылась, — ждёт границы аята. */
  готовый: HTMLAudioElement | null;
};

let аварийный: АварийныйРежим | null = null;

/** Неудачи в одной суре — от них растёт пауза перед проверкой. */
let неудачиСуры = { ключ: '', число: 0 };

function засчитатьНеудачу(reciter: ReciterId, surah: number): number {
  const ключ = `${reciter}:${surah}`;
  неудачиСуры = неудачиСуры.ключ === ключ
    ? { ключ, число: неудачиСуры.число + 1 }
    : { ключ, число: 1 };
  return неудачиСуры.число;
}

function забытьНеудачи() {
  неудачиСуры = { ключ: '', число: 0 };
}

/** Сплошная запись отказала — дочитываем поаятно, но ищем путь назад. */
function войтиВАварийныйРежим(reciter: ReciterId, surah: number) {
  снятьАварийныйРежим();
  const режим: АварийныйРежим = { reciter, surah, таймер: 0, готовый: null };
  аварийный = режим;
  режим.таймер = window.setTimeout(
    () => проверитьСплошную(режим),
    recoveryDelayMs(засчитатьНеудачу(reciter, surah)),
  );
}

/**
 * Выйти из аварийного режима без возврата: остановка, ручной выбор аята,
 * новая сура. Счётчик неудач здесь не трогаем: он привязан к суре, сам
 * обнуляется при её смене, а ручной запуск сбрасывает его явно
 * (`забытьНеудачи`) — человек начинает заново, и прошлые осечки не должны
 * растягивать ему паузу.
 */
function снятьАварийныйРежим() {
  const режим = аварийный;
  if (!режим) return;
  аварийный = null;
  if (режим.таймер) window.clearTimeout(режим.таймер);
  // Неиспользованный элемент проверки лежит вне кэша — гасим его здесь,
  // иначе он продолжал бы тянуть файл.
  const el = режим.готовый;
  if (el && audioCache.get(`${режим.reciter}:${режим.surah}:surah`) !== el) {
    el.removeAttribute('src');
    try { el.load(); } catch { /* элемент мог быть отцеплен */ }
  }
}

/**
 * Открывается ли сплошная запись снова.
 *
 * Достаточно заголовка файла (`loadedmetadata`): он доказывает, что источник
 * отвечает. Если после возврата поток всё же оборвётся, сработает обычная
 * цепочка отказа — повтор, поаятный режим и следующая проверка с удвоенной
 * паузой.
 */
function проверитьСплошную(режим: АварийныйРежим) {
  if (аварийный !== режим) return;
  режим.таймер = 0;
  const местная = localSurahSrc(режим.surah, режим.reciter);
  const src = местная ?? surahAudioUrl(режим.reciter, режим.surah);
  if (!src) return;

  const a = new Audio();
  a.preload = 'metadata';
  let решено = false;
  const итог = (открылась: boolean) => {
    if (решено) return;
    решено = true;
    window.clearTimeout(сторож);
    a.removeEventListener('loadedmetadata', удача);
    a.removeEventListener('error', отказ);
    if (аварийный !== режим || !открылась) {
      a.removeAttribute('src');
      try { a.load(); } catch { /* элемент мог быть отцеплен */ }
      if (аварийный === режим) {
        режим.таймер = window.setTimeout(
          () => проверитьСплошную(режим),
          recoveryDelayMs(засчитатьНеудачу(режим.reciter, режим.surah)),
        );
      }
      return;
    }
    // `preload` остаётся `metadata`: элемент может ждать границы аята долго
    // (пауза, длинный аят), и с `auto` он тянул бы начало суры, которое не
    // прозвучит, — играть предстоит с текущего аята, это всё равно перемотка.
    // До `auto` его поднимет `playOne`, когда звук пойдёт (ревью 13.09.2026).
    if (местная) подстраховатьМестныйФайл(a, режим.surah, режим.reciter);
    режим.готовый = a;
  };
  const удача = () => итог(true);
  const отказ = () => итог(false);
  const сторож = window.setTimeout(отказ, RECOVERY_PROBE_TIMEOUT_MS);
  a.addEventListener('loadedmetadata', удача);
  a.addEventListener('error', отказ);
  a.src = src;
  a.load();
}

/**
 * Вызывается на автоматической границе аята в поаятном режиме. Если
 * сплошная запись этой суры снова открылась, отдаёт её элемент в кэш и
 * возвращает `true` — вызывающий переключает режим обратно на `surah`.
 */
function вернутьсяНаСплошную(
  reciter: ReciterId,
  surah: number,
  уходящий: HTMLAudioElement | null,
): boolean {
  const режим = аварийный;
  if (!режим) return false;
  // Сменили чтеца посреди аварийного режима: проверка ищет запись прежнего
  // чтеца и никогда не пригодится — гасим её, а не качаем до конца суры.
  if (режим.reciter !== reciter || режим.surah !== surah) {
    снятьАварийныйРежим();
    return false;
  }
  const a = режим.готовый;
  if (!a || a.error) return false;
  // 🔴 Возвращаемся, только пока уходящий аят ещё ЗВУЧИТ.
  //
  // При заблокированном экране кадров нет, `timeupdate` приходит раз в
  // четверть секунды, и окно раннего перехода (50 мс) проскакивает — переход
  // идёт по настоящему `ended`, в тишине. Новый элемент при этом ещё должен
  // перемотаться в середину сетевого файла, а запуск в тишине iOS в фоне
  // отклоняет (см. переход между сурами): возврат остановил бы чтение, хотя
  // поаятно сура дочиталась бы. Поэтому в тишине и в фоне остаёмся поаятно
  // и пробуем на следующей границе (ревью 13.09.2026).
  const звучит = !!уходящий && (!уходящий.paused || finishingTail.has(уходящий));
  if (!звучит || document.hidden) return false;
  аварийный = null;
  touchCache(`${reciter}:${surah}:surah`, a);
  return true;
}

export function useAyahAudio(reciter: ReciterId = DEFAULT_RECITER) {
  const [activeKey, setActiveKey]   = useState<string | null>(null);
  const [audioState, setAudioState] = useState<AudioState>('idle');
  const [progress, setProgress]     = useState(0);          // 0..1 within current ayah
  /**
   * Длина звучащего файла, секунды; 0 — пока неизвестна.
   *
   * Нужна ползунку чтеца без границ аятов: у него `progress` считается по
   * всей записи суры, и время на ползунке — это `progress × duration`.
   * Меняется раз на файл, поэтому отдельный state не добавляет тиков.
   */
  const [duration, setDuration]     = useState(0);
  const [playbackRate, setPlaybackRateS] = useState<PlaybackRate>(readStoredRate);
  // 1-based word position inside the active ayah, or null if no segment data
  // exists for it / nothing is playing. Driven by the same rAF that powers
  // the progress bar, so we don't pay for two loops.
  const [currentWordPos, setCurrentWordPos] = useState<number | null>(null);
  /**
   * Последний отказ воспроизведения — чтобы сказать о нём человеку.
   *
   * 🔴 Раньше отказ был немым: чтение просто останавливалось. Со стороны
   * это выглядит как поломка приложения, а не как пропавшая связь, — на
   * это же указывал рецензент Apple. Здесь запоминается, на чём именно
   * оборвалось, чтобы плашка могла предложить повтор с того же места.
   */
  const [failure, setFailure] = useState<AudioFailure | null>(null);

  // Active queue: surah + bounds + current pointer
  const queueRef = useRef<{ surah: number; first: number; last: number; current: number } | null>(null);
  const reciterRef = useRef<ReciterId>(reciter);
  reciterRef.current = reciter;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  // Каждый режим Корана владеет своим экземпляром useAyahAudio, тогда как
  // сами <audio> лежат в общем кэше модуля. При размонтировании экрана явно
  // останавливаем этот кэш. Выбранная политика перехода — «полный stop», а
  // не попытка незаметно передать живой декодер другому React-дереву: так
  // кнопки, очередь и Media Session никогда не расходятся со слышимым звуком.
  useEffect(() => () => {
    stopCachedAyahAudio();
    queueRef.current = null;
    activeAudioRef.current = null;
  }, []);

  /** Cycle 1.0 → 1.25 → 0.75 → 1.0 (order from PLAYBACK_RATES starting
   *  at the current rate). Persists to localStorage and applies
   *  immediately to every cached audio so the change is audible without
   *  waiting for the next ayah. */
  const cyclePlaybackRate = useCallback(() => {
    setPlaybackRateS(prev => {
      const idx = PLAYBACK_RATES.indexOf(prev);
      const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
      localStorage.setItem(KEY_PLAYBACK_RATE, String(next));
      audioCache.forEach(a => { a.playbackRate = next; });
      return next;
    });
  }, []);

  const pauseCurrent = useCallback(() => {
    // Пауза в окне перехода между сурами: активный элемент — следующая сура
    // (ещё грузится), а звучит хвост прошлой. Без этого пауза с экрана
    // блокировки оставляла хвост звучать ещё до 4.5 с.
    audioCache.forEach(a => {
      if (!finishingTail.has(a)) return;
      finishingTail.delete(a);
      a.pause();
    });
    if (activeKey) {
      activeAudioRef.current?.pause();
      setAudioState('paused');
      setMediaSessionPlaybackState('paused');
    }
  }, [activeKey]);

  const stopAll = useCallback(() => {
    stopCachedAyahAudio();
    setActiveKey(null);
    setAudioState('idle');
    setProgress(0);
    setDuration(0);
    setCurrentWordPos(null);
    queueRef.current = null;
    activeAudioRef.current = null;
  }, []);

  const playOne = useCallback(async (
    surah: number,
    ayah: number,
    transition: 'manual' | 'automatic' = 'manual',
    /** Начать не с начала аята, а с этой секунды записи — повтор после
     *  сбоя у чтеца без границ аятов. */
    startAtSeconds?: number,
  ) => {
    // Любая новая попытка снимает прежнее сообщение об отказе.
    setFailure(null);
    const r = reciterRef.current;
    const k = cacheKey(r, surah, ayah);
    const mediaK = mediaCacheKey(r, surah, ayah);
    const range = rangeForMedia(r, surah, ayah);
    const cachedMedia = audioCache.get(mediaK);
    const seamlessSameMedia = transition === 'automatic'
      && range !== null
      && cachedMedia === activeAudioRef.current
      && cachedMedia !== undefined
      && !cachedMedia.paused;

    // Switching ayahs is explicit user intent ("I'm done with that one,
    // play this instead"), so every OTHER cached ayah snaps back to 0.
    // Without this, "tap ayah 1, listen to 10 s, tap ayah 2, then tap
    // ayah 1 again" would resume ayah 1 at the 10-second mark — exactly
    // the bug the user reported.  Resetting the just-paused element and
    // any prefetched neighbours together keeps a single invariant:
    // anywhere you re-enter a previously-played ayah, it starts fresh.
    if (activeKey && activeKey !== k) {
      audioCache.forEach((a, otherKey) => {
        // При автоматическом переходе внутри одной непрерывной записи
        // нельзя даже на мгновение вызвать pause(): звук продолжает идти,
        // меняются только логический аят, прогресс и подсветка.
        if (seamlessSameMedia && otherKey === mediaK) return;
        // Доигрывающему хвост не мешаем, но только при АВТОМАТИЧЕСКОМ
        // переходе: он сам остановится по `ended` или по звуку следующей
        // суры. Ручной выбор другого аята — это «хватит того», и хвост
        // глушится вместе с остальными, иначе две записи звучали бы разом.
        if (finishingTail.has(a)) {
          if (transition === 'automatic') return;
          finishingTail.delete(a);
        }
        a.pause();
        if (otherKey !== mediaK) a.currentTime = 0;
      });
    }

    const audio = getOrCreateAudio(mediaK, surah, ayah, r);
    activeAudioRef.current = audio;
    logicalKeyForAudio.set(audio, k);
    completedRange.delete(audio);

    // Длина файла для ползунка: у прогретого элемента она известна сразу,
    // у нового приходит с `durationchange`. Проверка владельца та же, что
    // у `ended`: поздние метаданные прежнего элемента не подменят длину.
    const syncDuration = () => {
      if (activeAudioRef.current !== audio) return;
      setDuration(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
    };
    audio.ondurationchange = syncDuration;
    syncDuration();

    // Switching to a different ayah → restart from 0. We also need this
    // when `activeKey` is null but the cached <audio> for `k` was left
    // mid-track from a previous SurahScreen mount (audioCache lives at
    // module scope and survives unmount / remount of the screen, so the
    // forEach above doesn't run on the first play after re-entering the
    // surah).  Resume-after-pause on the SAME ayah (activeKey === k)
    // deliberately skips this branch — that's the natural play / pause
    // behaviour and stays as is.
    if (activeKey !== k && !seamlessSameMedia) {
      // 🔴 Запуск суры с начала стартует с НУЛЯ, а не с границы первого аята.
      //
      // У Ясира Ад-Даусари и Ахмада Аль-Аджми запись суры начинается с
      // истиазы и басмалы: в таблице границ первый аят у них начинается не в
      // нуле (сура 18 — 7.21 с, сура 9 — 3.54 с; всего таких сур 77 и 91).
      // Прыжок на границу первого аята срезал бы вступление, и человек,
      // включивший суру целиком, не услышал бы её начала. У Аляфаси и
      // Аш-Шатри граница равна нулю, поэтому там ничего не меняется.
      const atSurahStart = startedWholeSurah && playbackMode === 'surah' && ayah === 1;
      // Явная секунда старта сильнее «с начала суры»: продолжение после
      // перезапуска приложения (lib/lastPlayback.ts) включает суру целиком,
      // но с того места, где остановились.
      seekAudio(audio, atSurahStart && startAtSeconds == null ? 0 : (startAtSeconds ?? range?.startSeconds ?? 0));
    }

    setActiveKey(k);
    // На автоматической границе непрерывного потока плеер уже звучит.
    // Не показываем промежуточный loading и не заставляем док мигать.
    setAudioState(prev => transition === 'automatic' && prev === 'playing' ? 'playing' : 'loading');
    setProgress(0);                                          // reset for the new ayah
    setCurrentWordPos(null);                                 // clear stale word from previous ayah

    // Lock Screen / Control Center Now Playing card.
    //
    // 🔴 НЕ переписываем её на каждом аяте. `MediaMetadata` заменяется
    // целиком, вместе с картинкой, и на границе аята это заставляло систему
    // заново разбирать карточку «сейчас играет» — несколько раз в минуту,
    // прямо в момент перехода. Владелец слышал на этом месте заминку.
    // На бесшовной границе одного и того же потока карточка и так верна:
    // сура, чтец и обложка не изменились.
    if (!seamlessSameMedia) {
      const surahMeta = SURAH_BY_NUMBER[surah];
      setMediaSessionMetadata({
        title:      surahMeta?.transliteration ?? `Surah ${surah}`,
        // У чтеца без границ аятов номер аята неизвестен — «Аят 1» на замке
        // всю суру был бы неправдой.
        album:      usesTimelineSeek(r) ? undefined : `Аят ${ayah}`,
        artist:     reciterRef.current,
        // PNG надёжнее SVG на Android — некоторые WebView версии
        // не рендерят SVG в Lock Screen artwork.
        artworkUrl: '/icons/icon-512.png',
      });
    }
    setMediaSessionPlaybackState('playing');

    // 🔴 Читаем ЗАПАС ВПЕРЁД, а не впритык.
    //
    // Сплошная запись суры создаётся с `preload='metadata'`: так первый
    // переход в середину Аль-Бакары не ждёт лишних байт. Но дальше эта же
    // бережливость выходила боком — браузер держал крошечный буфер и
    // дочитывал файл по ходу чтения. Владелец слышал заминку на границах
    // аятов и видел подгрузку, хотя сура вообще не была скачана.
    //
    // Как только звук пошёл, оценка меняется на противоположную: пусть
    // читает далеко вперёд. Файл раздаётся по частям (сервер отвечает 206),
    // поэтому это не «скачать 110 МБ разом», а обычный поток с запасом.
    // Повышаем один раз за элемент: повторное присваивание того же значения
    // Safari игнорирует, а лишний `load()` сбросил бы позицию.
    if (audio.preload !== 'auto') audio.preload = 'auto';

    // Only a REAL end of the recording may advance the queue.  Treating a
    // network/media error as `ended` is dangerous: while offline every MP3
    // fails immediately, so the old implementation ran through the whole
    // surah and SurahScreen's audio auto-scroll followed it to the bottom.
    const advanceOrStop = () => {
      const q = queueRef.current;
      if (!q) { остановить(); return; }

      // 🔴 Конец суры берём из данных, а не только из очереди.
      //
      // `handlePlay` без `lastAyah` кладёт в очередь 9999 — «до конца». С
      // таким значением условие «аят меньше последнего» истинно всегда, и на
      // последнем аяте плеер пытался открыть несуществующий следующий.
      const мета = SURAH_BY_NUMBER[q.surah];
      const конецСуры = Math.min(q.last, мета?.ayahs ?? q.last);

      if (ayah < конецСуры) {
        q.current = ayah + 1;
        // Поаятный режим после отказа — временный: если сплошная запись этой
        // суры снова открылась, следующий аят играет уже из неё.
        if (playbackMode === 'ayah'
          && вернутьсяНаСплошную(reciterRef.current, q.surah, activeAudioRef.current)) {
          playbackMode = 'surah';
        }
        playOne(q.surah, q.current, 'automatic');
        return;
      }

      // 🔴 Сура кончилась — идём в СЛЕДУЮЩУЮ, но ТОЛЬКО если слушали суру
      // целиком.
      //
      // Владелец 09.09.2026 сначала попросил не обрывать чтение на конце
      // суры, а увидев результат, уточнил: «только при слушать суру целиком».
      // Резон понятен: тап по одному аяту — это «покажи мне вот это», а не
      // «читай дальше», и уводить человека в следующую суру после одного аята
      // значит делать не то, о чём просили.
      //
      // `startedWholeSurah` взводится в `playFrom(..., 'surah')` — то есть
      // кнопкой «слушать суру целиком» — и снимается при тапе по аяту.
      // Перейдя в новую суру, взводим его снова: цепочка продолжается.
      //
      // Новая сура начинается с НУЛЯ записи, а не с границы первого аята:
      // иначе срезалась бы истиаза и басмала.
      if (!startedWholeSurah) { остановить(); return; }

      const r = reciterRef.current;
      // Сура, которой у чтеца нет, пропускается — чтение идёт дальше.
      const следующая = nextAvailableSurah(r, q.surah);
      const метаСледующей = следующая ? SURAH_BY_NUMBER[следующая] : undefined;
      if (!следующая || !метаСледующей) { остановить(); return; }

      снятьАварийныйРежим();
      playbackMode = hasSurahAudio(r) ? 'surah' : 'ayah';
      startedWholeSurah = true;
      queueRef.current = {
        surah: следующая,
        first: 1,
        last: timelineQueueBounds(r, 1, метаСледующей.ayahs).lastAyah,
        current: 1,
      };
      playOne(следующая, 1, 'automatic');
    };

    const остановить = () => {
      setAudioState('idle');
      setActiveKey(null);
      queueRef.current = null;
      setProgress(0);
      setDuration(0);
      activeAudioRef.current = null;
    };

    // WebKit can report the same failed load twice: first via `error`, then by
    // rejecting play().  Keep one terminal path and make sure a late failure
    // from an obsolete element cannot stop a newer ayah selected by the user.
    let failed = false;
    let stallTimer = 0;
    /** Позиция до повтора: после `load()` неудачного файла `currentTime`
     *  остаётся нулём, и место обрыва иначе потерялось бы. */
    let lastKnownPosition = startAtSeconds ?? 0;
    const stopStallWatch = () => {
      if (stallTimer) { window.clearTimeout(stallTimer); stallTimer = 0; }
    };
    /**
     * Сторож первого звука. На `setTimeout`, а не на кадрах: кадры не
     * приходят при заблокированном экране и в свёрнутом приложении
     * (`CLAUDE.md`, грабли §5), а фоновое прослушивание живёт именно там.
     */
    const startStallWatch = (ms: number = STALL_TIMEOUT_MS) => {
      stopStallWatch();
      stallTimer = window.setTimeout(() => {
        stallTimer = 0;
        if (failed) return;
        if (activeAudioRef.current !== audio || logicalKeyForAudio.get(audio) !== k) return;
        // Звук пошёл — сторож не нужен. Проверяем состояние элемента, а не
        // факт события: на бесшовной границе `playing` уже не повторится.
        if (!audio.paused && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
        failAndStop('stalled');
      }, ms);
    };

    const failAndStop = (reason: unknown) => {
      if (failed) return;
      failed = true;
      stopStallWatch();

      console.warn('[ayah-audio] playback failed on', `${surah}:${ayah}`, {
        reason,
        code: audio.error?.code,
        message: audio.error?.message,
        src: audio.src,
      });

      if (activeAudioRef.current !== audio || logicalKeyForAudio.get(audio) !== k) {
        return;
      }

      // 🔴 Сначала — один повтор того же источника.
      //
      // Сплошная запись идёт из сети, и одиночная осечка связи не повод
      // прекращать чтение. Второй шанс даётся один раз на элемент, иначе
      // приложение будет молча долбиться в мёртвую сеть.
      if (!retriedOnce.has(audio) && playbackMode === 'surah') {
        retriedOnce.add(audio);
        // У чтеца без границ аятов «начало аята» — это начало суры. Обрыв на
        // 25-й минуте не должен отбрасывать к нулю: повтор идёт с того места,
        // где замолчало. Позицию берём сейчас — `load()` её сбросит.
        const resumeAt = usesTimelineSeek(r) ? audio.currentTime : (range?.startSeconds ?? 0);
        lastKnownPosition = Math.max(lastKnownPosition, resumeAt);
        window.setTimeout(() => {
          if (activeAudioRef.current !== audio || logicalKeyForAudio.get(audio) !== k) return;
          failed = false;
          audio.load();
          seekAudio(audio, resumeAt);
          startStallWatch();
          void audio.play().catch(() => failAndStop('retry-failed'));
        }, RETRY_DELAY_MS);
        return;
      }

      // 🔴 Потом — поаятные файлы.
      //
      // Сплошная запись берётся из сети, когда её нет на диске. В самолёте
      // это отказ, и раньше выбор режима заранее уводил такие суры на
      // поаятное чтение — ценой шва у всех остальных. Теперь наоборот:
      // сплошная идёт всегда, а поаятные файлы включаются только здесь, по
      // факту неудачи. Повторного круга не будет: во второй раз режим уже
      // `ayah`, и условие не выполнится.
      const местныйАят = localAyahSrc(surah, ayah, r);
      if (playbackMode === 'surah' && местныйАят) {
        playbackMode = 'ayah';
        войтиВАварийныйРежим(r, surah);
        audio.onended = null;
        audio.onerror = null;
        audio.onwaiting = null;
        audio.onplaying = null;
        if (audioCache.get(mediaK) === audio) {
          audio.pause();
          audio.removeAttribute('src');
          audioCache.delete(mediaK);
        }
        void playOne(surah, ayah, transition);
        return;
      }

      // Stop the queue on the SAME ayah.  A downloaded local file still plays
      // normally offline because ayahAudioUrl() chooses it before the network
      // URL; this branch is reached only when the selected source truly fails.
      // Место обрыва — до `stopAll`: остановка кэша может сбросить позицию.
      const местоОбрыва = usesTimelineSeek(r)
        ? Math.max(lastKnownPosition, Number.isFinite(audio.currentTime) ? audio.currentTime : 0)
        : undefined;
      stopAll();
      if (audioCache.get(mediaK) === audio) audioCache.delete(mediaK);
      audio.onended = null;
      audio.onerror = null;
      // Порядок важен: `stopAll` сбрасывает состояние, и отказ ставится
      // после него, иначе плашка исчезла бы в том же кадре.
      setFailure({
        surah,
        ayah,
        lastAyah: queueRef.current?.last ?? SURAH_BY_NUMBER[surah]?.ayahs ?? ayah,
        positionSeconds: местоОбрыва,
        offline: typeof navigator !== 'undefined' && navigator.onLine === false,
      });
    };

    audio.onended = () => {
      if (failed) return;
      // 🔴 Конец уже сменившегося элемента — не переход. Хвост прошлой суры
      // доигрывает, пока звучит следующая (см. переход на последнем аяте), и
      // его настоящий конец файла пришёл бы сюда с замыканием прошлой суры:
      // её последний аят (у 83-й — 36) против очереди новой суры (у 84-й —
      // 25 аятов) решил бы, что и новая кончилась, и перепрыгнул бы через
      // неё. Та же проверка, что у отказа в `failAndStop`.
      if (activeAudioRef.current !== audio || logicalKeyForAudio.get(audio) !== k) return;
      setProgress(1);
      advanceOrStop();
    };
    audio.onerror = () => {
      failAndStop('media-error');
    };
    // 🔴 Обрыв посреди чтения. Медиаэлемент сообщает о нём `waiting`, а
    // `error` может не прийти вовсе — поток просто замолкает, и интерфейс
    // продолжает показывать «играет». Сторож переводит это в честный отказ:
    // повтор, потом поаятные файлы, потом остановка.
    audio.onwaiting = () => { if (!failed) startStallWatch(MIDSTREAM_STALL_MS); };
    audio.onplaying = () => { stopStallWatch(); };

    // Apply the user-selected playback rate before kicking off play() —
    // setting rate AFTER play() has known iOS Safari quirks (silent until
    // next .play(), or reverts to 1.0 on metadata load).
    audio.playbackRate = playbackRateRef.current;

    try {
      // Тот же audio уже играет через границу аята — повторный play() не
      // нужен и в некоторых WebView сам создаёт короткий щелчок/задержку.
      startStallWatch();
      if (!seamlessSameMedia) await audio.play();
      // `error` may have fired while WebKit was settling the play() promise.
      // Do not resurrect a queue that failAndStop() has already cleared.
      if (failed || activeAudioRef.current !== audio || logicalKeyForAudio.get(audio) !== k) {
        return;
      }
      stopStallWatch();
      setAudioState('playing');
      // Кэш по воспроизведению: аят, который только что зазвучал со
      // стрима, тихо оседает на устройстве.  Так офлайн-библиотека
      // растёт от обычного чтения, без единого нажатия «скачать» —
      // включая случай «ткнул в середину Бакары».  No-op, если аят уже
      // лежит или платформа не нативная.
      //
      // 🔴 Но НЕ в режиме непрерывного чтения суры. Там уже качается один
      // сплошной файл, и докачка поаятных поверх него означала бы, что
      // Аль-Бакара по сотовой сети тянет поток И ещё 286 отдельных mp3.
      // Офлайн-библиотека наполняется обычным чтением по аятам и кнопкой
      // «скачать» — этого достаточно.
      // Поаятного докачивания здесь больше НЕТ.
      //
      // Раньше прозвучавший аят тихо оседал на устройстве, и офлайн-библиотека
      // росла от обычного чтения. После перехода на сплошные записи это стало
      // одновременно бессмысленным и вредным: в режиме `surah` качается один
      // сплошной файл, а поаятный режим включается только аварийно — то есть
      // когда сети и так нет и качать нечего.
      // Pre-warm the next ayah so auto-advance is gap-free.  We only
      // prefetch ONE ahead — going further wastes mobile data on ayahs
      // the user might never reach (e.g. they tap a different ayah,
      // pause, or close the screen).  One-ahead matches the perceived
      // "queue depth" needed: by the time current ayah ends, next is
      // ready in the HTTP cache.
      const q = queueRef.current;
      const nextAyah = ayah + 1;
      if (q && q.surah === surah && nextAyah <= q.last) {
        prefetchAyah(surah, nextAyah, r);
      }
    } catch (err) {
      // `AbortError` — это не сбой: `play()` прервали паузой или сменой
      // источника. Раньше он шёл в `failAndStop`, и через 900 мс повтор сам
      // включал звук вопреки нажатой паузе. Настоящие сбои приходят
      // событием `error` и сторожем — их это не касается.
      if (err instanceof DOMException && err.name === 'AbortError') {
        stopStallWatch();
        return;
      }
      failAndStop(err);
    }
  }, [activeKey, stopAll]);

  /** Tap on an ayah — play / pause that ayah, joining the queue. */
  /**
   * У чтеца нет записи этой суры — сказать прямо, а не ходить в сеть.
   *
   * Без этого запрос уходил за несуществующим файлом, сервер отвечал 404, и
   * человек видел «Не удалось загрузить чтение» с кнопкой «Повторить», которая
   * никогда не поможет.
   */
  const отказНетСуры = useCallback((surah: number, ayah: number) => {
    if (reciterHasSurah(reciterRef.current, surah)) return false;
    stopAll();
    setFailure({
      surah, ayah, lastAyah: SURAH_BY_NUMBER[surah]?.ayahs ?? ayah,
      offline: false, unavailable: true,
    });
    return true;
  }, [stopAll]);

  const handlePlay = useCallback((
    surah: number,
    requestedAyah: number,
    requestedLast?: number,
    startAtSeconds?: number,
  ) => {
    // У чтеца без границ аятов тап по любому аяту — это вся запись суры:
    // начать её, а на звучащей суре — пауза или продолжение с того же места.
    if (отказНетСуры(surah, requestedAyah)) return;
    const timeline = usesTimelineSeek(reciterRef.current);
    const ayah = timeline ? 1 : requestedAyah;
    const lastAyah = timeline ? 1 : requestedLast;
    const k = cacheKey(reciterRef.current, surah, ayah);

    if (queueRef.current?.surah !== surah) {
      queueRef.current = { surah, first: ayah, last: lastAyah ?? 9999, current: ayah };
    } else {
      queueRef.current.current = ayah;
      if (lastAyah && queueRef.current.last < lastAyah) queueRef.current.last = lastAyah;
    }

    // 🔴 Режим меняем только когда РЕАЛЬНО начинаем играть.
    //
    // Раньше `playbackMode = 'ayah'` стояло в начале, безусловно. Тап по уже
    // звучащему аяту ставит паузу и ничего не запускает — но режим при этом
    // всё равно переключался, а элемент оставался непрерывным. Дальше
    // возобновление с экрана блокировки играло сплошную запись, а границы
    // аятов пропадали: подсветка и номер аята замирали, пока запись читала
    // дальше. Показано было не то, что звучит.
    // 🔴 Тап по аяту тоже читает СПЛОШНУЮ запись, а не короткий файл аята.
    //
    // Раньше здесь всегда стоял поаятный режим: тап должен звучать сразу, а
    // не ждать большой файл. Но у тапа есть продолжение — очередь идёт до
    // конца суры, и на каждой границе приходилось подменять аудиоэлемент.
    // Именно это владелец слышит как микропаузу между аятами. Подгонкой
    // таймингов её не убрать: пауза не в записи, а в запуске нового
    // элемента. Известная проблема — схема «дождаться `ended` и вызвать
    // `play()`» негодна в принципе, потому что и событие приходит поздно, и
    // воспроизведение стартует не мгновенно.
    //
    // В сплошной записи подмены нет вовсе: на границе аята меняется только
    // логический номер, а поток читается дальше тем же декодером — шва нет
    // по построению. Сплошная запись есть у всех пяти чтецов, тайминги
    // аятов — тоже, а хосты отвечают на частичные запросы (206), поэтому
    // старт с середины суры не тянет файл целиком.
    //
    // Исключение — полностью скачанная сура: там играем локальные файлы,
    // иначе офлайн вообще останется без звука. Шов в этом случае
    // сохраняется, и это честная плата за работу без сети.
    const startPlayback = () => {
      const r = reciterRef.current;
      // 🔴 Сплошная запись — ВСЕГДА, пока она у чтеца есть.
      //
      // Здесь стояло `hasSurahFile(...) || (!offlineComplete && hasSurahAudio(r))`,
      // и из-за второй половины приложение само себя портило. Автозагрузка
      // наполняет фонотеку поаятными файлами; как только у суры собирались
      // все аяты, `offlineComplete` становился истиной, и эта же сура
      // начинала играть поаятно — со швом на каждой границе. Чем дольше
      // телефон стоял на Wi-Fi, тем больше сур переезжало на плохой путь, и
      // никакая правка таймингов этого не лечила: шов не в записи, а в
      // подмене аудиоэлемента.
      //
      // Поаятный режим больше не выбирается заранее никогда. Он остался
      // аварийным: если сплошная запись не открылась (нет сети и файла нет),
      // `failAndStop` переключит режим и повторит тот же аят.
      снятьАварийныйРежим();
      забытьНеудачи();
      playbackMode = hasSurahAudio(r) ? 'surah' : 'ayah';
      // Тап по звучащей суре у чтеца без границ аятов — это «продолжить», а
      // не новое намерение: начатое «слушать суру целиком» должно и дальше
      // уходить в следующую суру.
      if (!(timeline && activeKey === k)) startedWholeSurah = false;
      playOne(surah, ayah, 'manual', startAtSeconds);
    };

    if (activeKey === k) {
      if (audioState === 'playing') pauseCurrent();
      else startPlayback();
    } else {
      startPlayback();
    }
  }, [activeKey, audioState, pauseCurrent, playOne, отказНетСуры]);

  /** Start sequential playback from `fromAyah` through `lastAyah`. */
  /**
   * Включить суру подряд.
   *
   * `mode: 'surah'` переводит источник на непрерывную запись — только так
   * между аятами не остаётся паузы. Умолчание оставлено прежним, чтобы
   * никакой существующий вызов не сменил поведение молча.
   */
  const playFrom = useCallback((
    surah: number, requestedFrom: number, requestedLast: number, mode: PlaybackMode = 'ayah',
    /** Секунда записи, с которой начать (продолжение с запомненного места). */
    startAtSeconds?: number,
  ) => {
    if (отказНетСуры(surah, requestedFrom)) return;
    const { fromAyah, lastAyah } = timelineQueueBounds(
      reciterRef.current, requestedFrom, requestedLast,
    );
    // Режим тот же, что и при тапе: сплошная запись, пока она есть у чтеца.
    // Локальный файл предпочитается сетевому внутри `getOrCreateAudio`, а
    // отсутствие и того и другого разбирает аварийная ветка в `failAndStop`.
    // Здесь `mode` управляет только тем, начинать ли суру с нуля записи.
    снятьАварийныйРежим();
    забытьНеудачи();
    playbackMode = hasSurahAudio(reciterRef.current) ? 'surah' : 'ayah';
    startedWholeSurah = mode === 'surah';
    queueRef.current = { surah, first: fromAyah, last: lastAyah, current: fromAyah };
    playOne(surah, fromAyah, 'manual', startAtSeconds);
  }, [playOne, отказНетСуры]);

  // 60fps progress driver — rAF loop bound to active audio. The native
  // `timeupdate` event fires only 4–10×/s; rAF gives us per-frame smoothness
  // for the progress hairline AND drives the word-position cursor for the
  // karaoke highlight (single source of truth, no second rAF per ayah).
  //
  // 🔴 Та же работа подписана и на `timeupdate`, и это не дубль ради надёжности.
  // Кадры не приходят при заблокированном экране и в свёрнутом приложении
  // (`CLAUDE.md`, грабли §5) — а именно там и живёт фоновое прослушивание суры.
  // Без `timeupdate` звук шёл бы дальше, а граница аята не наступала никогда:
  // очередь и Now Playing застревали бы на первом аяте, и по возвращении
  // приложение догоняло бы их по одному за кадр. `timeupdate` — событие
  // медиаэлемента, оно приходит и в фоне.
  //
  // Поэтому работа отделена от планирования: `step` считает, `tick` только
  // просит следующий кадр. Иначе вызов из `timeupdate` плодил бы параллельные
  // циклы rAF.
  useEffect(() => {
    if (audioState !== 'playing' || !activeKey) return;
    const audio = activeAudioRef.current;
    if (!audio) return;

    // activeKey is "reciter:surah:ayah" — split it. Segments are now
    // keyed by reciter so the marker tracks the actual cadence of
    // whoever is reciting (Husary is slower than Alafasy by ~2× —
    // re-using Alafasy timings on a Husary track threw the highlight
    // visibly out of sync, which is what the user reported). When the
    // reciter has no quran.com segment data (e.g. Maher Al-Muaiqly,
    // not in their catalog), getQuranSegments returns null and the
    // marker stays put — no false sync.
    const [reciterId, ...rest] = activeKey.split(':');
    const verseKey = rest.join(':');
    const [surahPart, ayahPart] = rest;
    const range = rangeForMedia(
      reciterId as ReciterId,
      Number(surahPart),
      Number(ayahPart),
    );
    const rangeStart = range?.startSeconds ?? 0;

    // Lazy-loaded segments: при первом воспроизведении модуль ещё может
    // быть в загрузке (промис не resolved).  Используем cached если уже
    // есть, иначе fire-and-forget загрузку и подхватим segments сразу
    // после resolve.  rAF-tick между этим работает без segments, marker
    // не двигается — даёт ~100-300 мс «холодного старта», после чего
    // подсветка включается естественно.
    let segs: ReadonlyArray<readonly [number, number, number]> | null =
      segmentsModuleCached
        ? (segmentsModuleCached.getQuranSegments(reciterId as ReciterId, verseKey)?.segments ?? null)
        : null;
    if (!segmentsModuleCached && RECITERS_WITH_SEGMENTS.has(reciterId as ReciterId)) {
      loadSegmentsModule().then(m => {
        segs = m.getQuranSegments(reciterId as ReciterId, verseKey)?.segments ?? null;
      });
    }

    let raf = 0;
    /** Файл следующей суры уже прогрет в этом эффекте — не звать на каждом кадре. */
    let прогретаСледующая = false;
    let positionUpdateTick = 0;
    let lastProgressWrite = -Infinity;
    const step = () => {
      // The same HTMLAudioElement is reused between Luhaidan ayahs in one
      // surah. An old rAF must stop immediately when the logical ayah changes,
      // otherwise it can finish the newly selected ayah using the old range.
      if (logicalKeyForAudio.get(audio) !== activeKey) return;

      // 🔴 Поаятный режим: переходим на следующий аят чуть РАНЬШЕ конца.
      //
      // В этом режиме каждый аят — отдельный файл, и переход ждал события
      // `ended`. Оно приходит с задержкой, и запуск следующего элемента тоже
      // не мгновенный: замерили разрыв между `ended` одного файла и `playing`
      // следующего — 21, 27, 15, 56, 35 мс, в среднем 31.
      //
      // Приём известный: не ждать события, а начать переход, когда до конца
      // осталась малость. Здесь важно, ЧТО ИМЕННО мы делаем: следующий аят
      // запускается, пока текущий ещё доигрывает свой хвост, и текущий никто
      // не останавливает досрочно. Чтение не обрезается — оно доходит до
      // конца само. Пятьдесят миллисекунд наложения на затухающем хвосте
      // неразличимы на слух, а разрыв на их величину уменьшается.
      //
      // Непрерывной записи это не касается: там ветка `range` выше и швов
      // нет вовсе.
      if (!range && !completedRange.has(audio) && !audio.paused
        && Number.isFinite(audio.duration) && audio.duration > 0
        && audio.duration - audio.currentTime <= EARLY_ADVANCE_SECONDS) {
        completedRange.add(audio);
        setProgress(1);
        // Даём хвосту доиграть: без пометки следующий `playOne` остановил бы
        // этот элемент и обрезал конец аята. Снимаем пометку по настоящему
        // `ended` — дальше элемент обычный и его можно перематывать.
        finishingTail.add(audio);
        audio.addEventListener('ended', () => finishingTail.delete(audio), { once: true });
        audio.onended?.(new Event('ended'));
        return;
      }

      // Последний аят перед следующей сурой: заранее грузим её файл.
      // У чтеца без границ аятов `range` нет, а прогрев нужен тем более:
      // переход у него идёт за 50 мс до конца большого файла, и без запаса
      // следующая сура начинала бы грузиться с нуля в тишине.
      if (!прогретаСледующая && (range || usesTimelineSeek(reciterId as ReciterId))
        && !completedRange.has(audio)
        && Number.isFinite(audio.duration)
        && audio.duration - audio.currentTime <= PREWARM_NEXT_SURAH_SECONDS
        && уходитВСледующуюСуру(queueRef.current, Number(surahPart), Number(ayahPart), reciterId as ReciterId)) {
        прогретаСледующая = true;
        const следующая = nextAvailableSurah(reciterId as ReciterId, Number(surahPart));
        if (следующая) прогретьСуру(следующая, reciterId as ReciterId);
      }

      if (range && audio.currentTime >= range.endSeconds) {
        if (!completedRange.has(audio)) {
          completedRange.add(audio);
          setProgress(1);
          const q = queueRef.current;
          const hasNextInSameSurah = q?.surah === Number(surahPart)
            && q.current === Number(ayahPart)
            && Number(ayahPart) < q.last;
          // В непрерывном файле суры не останавливаем звук на границе.
          // onended здесь означает конец ЛОГИЧЕСКОГО аята; физический
          // HTMLAudioElement продолжает читать следующий байт потока.
          if (!hasNextInSameSurah) {
            if (уходитВСледующуюСуру(q, Number(surahPart), Number(ayahPart), reciterId as ReciterId)) {
              // 🔴 Не глушим перед следующей сурой. Раньше здесь стояла
              // пауза, и следующая сура запускалась в тишине — в фоне iOS
              // такой запуск отклоняет, и чтение замирало (владелец
              // 13.09.2026: «когда дочитывается, просто останавливается»).
              // Хвост записи доигрывает сам, следующая сура стартует, пока он
              // ещё звучит, — тем же приёмом, что в поаятном режиме.
              finishingTail.add(audio);
              const хвостКончился = () => finishingTail.delete(audio);
              audio.addEventListener('ended', хвостКончился, { once: true });
              // 🔴 Хвост нужен ровно до первого звука следующей суры — не
              // дольше. У Люхайдана после последнего аята в записи идёт ещё
              // около 4.5 с, и доигрывая целиком, хвост звучал бы поверх
              // начала следующей суры (замер 13.09.2026: 180 кадров по 50 мс
              // с двумя играющими элементами). Глушим его в момент `playing`
              // следующего элемента: наложение — десятки миллисекунд, а
              // тишины между сурами нет. Пока следующая ещё грузится, хвост
              // звучит один и держит звук живым для iOS.
              // Ветку охраняет `уходитВСледующуюСуру`: следующая доступная
              // сура у чтеца точно есть. Запасного «+1» нет намеренно — он
              // вёл бы за несуществующей записью.
              const следующая = nextAvailableSurah(reciterId as ReciterId, Number(surahPart));
              if (следующая) прогретьСуру(следующая, reciterId as ReciterId);
              if (следующая) audioCache.get(mediaCacheKey(reciterId as ReciterId, следующая, 1))
                ?.addEventListener('playing', () => {
                  audio.removeEventListener('ended', хвостКончился);
                  if (!finishingTail.has(audio)) return;
                  finishingTail.delete(audio);
                  audio.pause();
                }, { once: true });
            } else {
              audio.pause();
              seekAudio(audio, range.endSeconds);
            }
          }
          audio.onended?.(new Event('ended'));
        }
        return;
      }

      const d = range
        ? range.endSeconds - range.startSeconds
        : audio.duration;
      const elapsed = Math.max(0, audio.currentTime - rangeStart);
      if (d && isFinite(d) && d > 0) {
        // Progress нужен только тонкой полосе плеера. Обновление React-state
        // 60 раз/с заставляло заново рендерить всю тяжёлую суру и страницу
        // мусхафа. 12–13 раз/с визуально плавны для полосы, но освобождают
        // главный поток для прокрутки и арабского шейпинга.
        const now = performance.now();
        if (now - lastProgressWrite >= 80) {
          lastProgressWrite = now;
          setProgress(Math.min(1, Math.max(0, elapsed / d)));
        }
        // MediaSession position info — но не на каждый кадр (60 раз/с
        // расходует battery впустую); раз в ~10 кадров (~6 раз/с).
        positionUpdateTick = (positionUpdateTick + 1) % 10;
        if (positionUpdateTick === 0) {
          setMediaSessionPosition(Math.min(elapsed, d), d, audio.playbackRate);
        }
      }
      // Word-position lookup. Linear scan is fine — 30 words max per ayah.
      if (segs) {
        const ms = elapsed * 1000;
        let found: number | null = null;
        for (let i = 0; i < segs.length; i++) {
          const [w, s, e] = segs[i];
          if (ms >= s && ms <= e) { found = w; break; }
        }
        setCurrentWordPos(prev => prev === found ? prev : found);
      }
    };
    const tick = () => { step(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    audio.addEventListener('timeupdate', step);
    return () => {
      cancelAnimationFrame(raf);
      audio.removeEventListener('timeupdate', step);
    };
  }, [audioState, activeKey]);

  /**
   * Перемотка по времени — только у чтеца без границ аятов.
   *
   * У остальных позиция в записи привязана к логическому аяту, и прыжок на
   * произвольную секунду развёл бы звучащее с подсвеченным; там перемотка
   * идёт по аятам (`next`/`prev`).
   *
   * Самый конец не отдаём: последняя секунда остаётся доиграть, и переход к
   * следующей суре (или остановка) идёт обычной дорогой — через ранний
   * переход в кадровом цикле, а не через особый случай «перемотали в конец».
   */
  const seekTo = useCallback((seconds: number) => {
    if (!usesTimelineSeek(reciterRef.current)) return;
    const audio = activeAudioRef.current;
    if (!audio || !queueRef.current) return;
    const d = audio.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    const target = Math.min(Math.max(0, d - 1), Math.max(0, seconds));
    seekAudio(audio, target);
    // На паузе кадровый цикл стоит — ползунок и экран блокировки обновляем
    // сами, иначе они остались бы на прежнем месте до запуска.
    setProgress(target / d);
    setMediaSessionPosition(target, d, audio.playbackRate);
  }, []);

  const seekBy = useCallback((deltaSeconds: number) => {
    const audio = activeAudioRef.current;
    if (!audio) return;
    seekTo(audio.currentTime + deltaSeconds);
  }, [seekTo]);

  // У чтеца без границ аятов «соседний аят» — это шаг по времени. Так одни
  // и те же кнопки дока, стрелки клавиатуры и экран блокировки работают
  // для любого чтеца, и ни одна из них не перезапускает суру с нуля.
  const next = useCallback(() => {
    if (usesTimelineSeek(reciterRef.current)) { seekBy(TIMELINE_SEEK_STEP_SECONDS); return; }
    const q = queueRef.current;
    if (!q) return;
    const ayah = Math.min(q.current + 1, q.last);
    if (ayah !== q.current) { q.current = ayah; playOne(q.surah, ayah); }
  }, [playOne, seekBy]);

  const prev = useCallback(() => {
    if (usesTimelineSeek(reciterRef.current)) { seekBy(-TIMELINE_SEEK_STEP_SECONDS); return; }
    const q = queueRef.current;
    if (!q) return;
    const ayah = Math.max(q.current - 1, q.first);
    if (ayah !== q.current) { q.current = ayah; playOne(q.surah, ayah); }
  }, [playOne, seekBy]);

  /**
   * Wall-clock seconds left in the active ayah, divided by playback rate
   * so 1.25× playback shrinks the value proportionally. Used by
   * SurahScreen's auto-scroll to decide between smooth and instant —
   * if the next ayah change is closer than the smooth animation can
   * reasonably finish, we snap. `Infinity` when there's no active audio.
   */
  /**
   * Продолжить с того места, где остановились.
   *
   * 🔴 Именно продолжить, а не перезапустить аят. Раньше и мини-плеер, и
   * полный плеер, и лента звали `playFrom(сура, текущий аят, …)` — это
   * начинало аят заново, и после паузы посреди длинного аята чтение
   * откатывалось к его началу. Медиаэлемент при паузе сохраняет позицию,
   * и достаточно его отпустить.
   *
   * Если элемента уже нет (сменился чтец, память освободили) — честно
   * запускаем очередь с текущего аята.
   */
  const resume = useCallback(() => {
    const q = queueRef.current;
    if (!q) return;
    const audio = activeAudioRef.current;
    if (audio && audio.paused && audio.src) {
      // Состояние ставим ТОЛЬКО после успешного старта: раньше `playing`
      // объявлялось сразу, а отказ проглатывался — на экране блокировки
      // висело «играет» при полной тишине.
      void audio.play()
        .then(() => {
          setAudioState('playing');
          setMediaSessionPlaybackState('playing');
        })
        .catch(() => {
          setAudioState('paused');
          setMediaSessionPlaybackState('paused');
        });
      return;
    }
    playFrom(q.surah, q.current, q.last, playbackMode);
  }, [playFrom]);

  const getRemainingSeconds = useCallback(() => {
    if (!activeKey) return Infinity;
    const audio = activeAudioRef.current;
    if (!audio) return Infinity;
    const [reciterId, surahPart, ayahPart] = activeKey.split(':');
    const range = rangeForMedia(
      reciterId as ReciterId,
      Number(surahPart),
      Number(ayahPart),
    );
    const end = range?.endSeconds ?? audio.duration;
    if (!isFinite(end) || end <= 0) return Infinity;
    const remaining = (end - audio.currentTime) / Math.max(0.1, audio.playbackRate);
    return remaining > 0 ? remaining : 0;
  }, [activeKey]);

  return {
    activeKey,
    audioState,
    progress,
    duration,
    playbackRate,
    cyclePlaybackRate,
    currentSurah: queueRef.current?.surah ?? null,
    currentAyah:  queueRef.current?.current ?? null,
    currentWordPos,                                          // 1-based word in active ayah
    getRemainingSeconds,
    handlePlay,
    playFrom,
    /** Режим текущей сессии — нужен возобновлению после паузы, чтобы оно
     *  не сбрасывало непрерывное чтение суры обратно на поаятное. */
    currentMode: () => playbackMode,
    next,
    prev,
    seekTo,
    seekBy,
    pause: pauseCurrent,
    resume,
    stopAll,
    failure,
    dismissFailure: () => setFailure(null),
  };
}
