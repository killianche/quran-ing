/**
 * Reciter catalog.
 *
 * Чтецы из RECITERS_WITH_SEGMENTS имеют пословные тайминги на quran.com,
 * поэтому караоке-подсветка работает для них на всех доступных аятах
 * (см. content/quran-segments.ts).
 *
 * Аудио приходит с одного из четырёх источников:
 *
 *   - islamic.network — cdn.islamic.network/quran/audio/64/{slug}/{globalAyah}.mp3
 *     короткие mp3 по одному аяту, 64 kbps, сквозная нумерация 1..6236.
 *
 *   - everyayah.com — everyayah.com/data/{everyayahDir}/{SSSAAA}.mp3
 *     то же самое, но нумерация относительно суры (001001.mp3 для 1:1).
 *     Резерв для чтецов, которых islamic.network не раздаёт.
 *
 *   - собственный сервер — {ayahAudioBase}/{SSS}/{AAA}.mp3
 *     заранее подготовленные короткие файлы отдельных аятов. Такой путь
 *     используется для Люхайдана: приложение сразу открывает выбранный
 *     аят, а не загружает и не перематывает большой файл всей суры.
 *
 *   - mp3quran.net — serverN.mp3quran.net/{dir}/{SSS}.mp3
 *     запись целой суры. Для такого источника приложение вырезает нужный
 *     аят по локальной таблице границ и не делает вид, будто это отдельный
 *     поаятный файл.
 *
 * Должен быть задан `ayahAudioBase`, `slug` либо `everyayahDir`; при
 * нескольких вариантах выигрывает `ayahAudioBase`, затем `slug`.
 * Реальный URL для воспроизведения сначала ищет скачанный аят в памяти
 * устройства и только затем обращается к удалённому источнику.
 *
 * В прежнем QuranIng чтецов было восемь (+ Al-Sudais и Maher Al-Muaiqly, снятые
 * ранее).  В QuranRu список держим намеренно коротким: словарь таймингов
 * на восемь чтецов весил 10.5 МБ и был самым тяжёлым чанком приложения.
 * Чтобы вернуть чтеца, нужно добавить запись сюда и
 * прогнать scripts/gen/fetch-quran-segments.mjs — он дописывает бакет
 * таймингов в content/quran-segments.ts.
 */

import { TOTAL_SURAHS } from './ayahNumbering';

export type ReciterId =
  | 'alafasy'
  | 'shaatree'
  | 'yasser'
  | 'luhaidan'
  | 'ajmi'
  | 'merzhoev';

export type Reciter = {
  id: ReciterId;
  label: string;
  /** Имя по-арабски. В интерфейсе сейчас не выводится; у чтеца без
   *  проверенного арабского написания не заполняется — не выдумываем. */
  arabic?: string;
  /** Битрейт источника — нужен для честной оценки офлайн-загрузки. */
  bitrateKbps: 64 | 128;
  /** islamic.network slug — быстрый путь по сквозному номеру аята. */
  slug?: string;
  /** everyayah.com directory name.  Используется, когда нет `slug`.
   *  Путь: https://everyayah.com/data/{everyayahDir}/{SSSAAA}.mp3 */
  everyayahDir?: string;
  /** Base URL отдельных файлов аятов.
   *  Путь: {ayahAudioBase}/{SSS}/{AAA}.mp3 */
  ayahAudioBase?: string;
  /** Base URL непрерывной записи по одной полной суре. Используется как
   *  основной поток только у чтецов без отдельных файлов каждого аята. */
  surahAudioBase?: string;
  /** Имя файла суры: 001.mp3 вместо 1.mp3. */
  surahAudioPadded?: boolean;
  /**
   * У чтеца есть только записи целых сур, а границ аятов нет.
   *
   * Такая сура слушается как трек музыкального плеера: перемотка на 10
   * секунд и ползунок по времени вместо перехода по аятам, без подсветки
   * и автопрокрутки к аяту — показать звучащий аят нечем, а угадывать его
   * значит показывать не то, что звучит. См. `usesTimelineSeek`.
   */
  timelineOnly?: true;
  /**
   * Суры, для которых у чтеца есть запись; не задано — все 114.
   *
   * Отсутствующая сура — не сбой сети: приложение говорит «у чтеца нет
   * записи этой суры» вместо плашки ошибки, а непрерывное чтение
   * перепрыгивает её к следующей доступной (`nextAvailableSurah`).
   */
  availableSurahs?: readonly number[];
  /**
   * Точный размер файла каждой суры, байт — для оценки загрузки.
   *
   * Средний вес аята (`estimateBytes`) у чтеца с другим темпом ошибается в
   * полтора раза: «Аль-Бакару» Мержоева он обещал в 77 МБ, а она весит 116.
   * Человек решает, качать ли почти гигабайт, по этой цифре — она обязана
   * быть правдой. Снято с файлов на сервере; новая сура — добавить её размер
   * сюда вместе с номером в `availableSurahs` (тест сверяет оба списка).
   */
  surahBytes?: Readonly<Record<number, number>>;
};

export const RECITERS: Reciter[] = [
  {
    id: 'alafasy', label: 'Мишари Аляфаси', arabic: 'مشاري العفاسي',
    bitrateKbps: 64, slug: 'ar.alafasy',
    surahAudioBase: 'https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal',
  },
  {
    id: 'shaatree', label: 'Абу Бакр Аш-Шатри', arabic: 'أبو بكر الشاطري',
    bitrateKbps: 64, slug: 'ar.shaatree',
    surahAudioBase: 'https://download.quranicaudio.com/qdc/abu_bakr_shatri/murattal',
  },
  {
    id: 'yasser',
    label: 'Ясир Ад-Даусари',
    arabic: 'ياسر الدوسري',
    bitrateKbps: 128,
    everyayahDir: 'Yasser_Ad-Dussary_128kbps',
    surahAudioBase: 'https://download.quranicaudio.com/quran/yasser_ad-dussary',
    surahAudioPadded: true,
  },
  {
    id: 'luhaidan',
    label: 'Мухаммад Аль-Люхайдан',
    arabic: 'محمد اللحيدان',
    bitrateKbps: 128,
    ayahAudioBase: 'https://l.asrbook.ru/audio/luhaidan',
    surahAudioBase: 'https://server8.mp3quran.net/lhdan',
    surahAudioPadded: true,
  },
  {
    id: 'ajmi',
    label: 'Ахмад Аль-Аджми',
    arabic: 'أحمد بن علي العجمي',
    bitrateKbps: 128,
    everyayahDir: 'Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net',
    surahAudioBase: 'https://download.quranicaudio.com/quran/ahmed_ibn_3ali_al-3ajamy',
    surahAudioPadded: true,
  },
  /**
   * Хьусейн Мержоев — друг владельца (решение владельца 03–04.10.2026).
   *
   * Записи целых сур из его Telegram-канала t.me/khmerzhoev1111 (исходник
   * MP3 320 кбит/с), сжаты в 128 кбит/с CBR стерео: постоянный битрейт даёт
   * точную перемотку по времени. Раздаются с сервера Quran Ing
   * (Caddy `quraning-audio.…sslip.io` → /var/www/quraning/audio/merzhoev).
   * Таймингов аятов нет — режим перемотки по времени (`timelineOnly`).
   * Записи есть для 80 сур; остальные 34 владелец пришлёт, когда появятся.
   */
  {
    id: 'merzhoev',
    label: 'Хьусейн Мержоев',
    bitrateKbps: 128,
    surahAudioBase: 'https://quraning-audio.217-177-75-68.sslip.io/audio/merzhoev',
    surahAudioPadded: true,
    timelineOnly: true,
    availableSurahs: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16, 17, 18, 19, 21, 22, 25, 31, 32,
      33, 36, 37, 43, 45, 47, 49, 50, 51, 53, 55, 56, 62, 63, 67, 68, 70, 71,
      72, 73, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90,
      91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106,
      107, 108, 109, 110, 111, 112, 113, 114
    ],
    // Снято 2026-10-04 с /var/www/quraning/audio/merzhoev (80 файлов, 845 МБ).
    surahBytes: {
      1: 1009921, 2: 121790094, 3: 69273519, 4: 66470680, 5: 47843915,
      6: 49787008, 7: 60158247, 8: 20753475, 9: 44634823, 12: 27832020,
      15: 10691943, 16: 27845820, 17: 24764627, 18: 23755674, 19: 14792115,
      21: 18953325, 22: 20013265, 25: 13299593, 31: 8412806, 32: 6145799,
      33: 20310856, 36: 12143504, 37: 16676699, 43: 15624696, 45: 7907081,
      47: 8337995, 49: 5765465, 50: 6336379, 51: 6190521, 53: 5597017,
      55: 7353285, 56: 6965003, 62: 2580194, 63: 2794613, 67: 5074988,
      68: 5276028, 70: 3836581, 71: 3521006, 72: 4151714, 73: 3191256,
      75: 3075473, 76: 4043883, 77: 3314968, 78: 3459156, 79: 3927266,
      80: 3120187, 81: 2005908, 82: 1625985, 83: 3560726, 84: 2127540,
      85: 2338185, 86: 1285772, 87: 1412828, 88: 1749289, 89: 2889897,
      90: 1485137, 91: 1172499, 92: 1498093, 93: 844403, 94: 530934,
      95: 733642, 96: 1235199, 97: 537205, 98: 1732990, 99: 736158,
      100: 859874, 101: 756222, 102: 666776, 103: 387158, 104: 691020,
      105: 523414, 106: 435647, 107: 562703, 108: 280164, 109: 507536,
      110: 443580, 111: 472423, 112: 302732, 113: 420599, 114: 522991
    },
  },
];

/**
 * Чтец по умолчанию.
 *
 * Решение владельца 04.09.2026 — заменить Мишари Аляфаси на Ясира
 * Ад-Даусари. Причина измеренная, а не вкусовая: владелец слышал паузу
 * между аятами, и она оказалась не в коде, а в самой записи — вдох чтеца.
 * Скачали суру 112 у четырёх чтецов, декодировали и померили тишину вокруг
 * границ аятов: Аляфаси 143 мс, Аш-Шатри 31 мс, Ясир и Аль-Аджми 0 мс.
 *
 * Ясир при этом не теряет ничего из возможностей: у него есть и сплошная
 * запись суры, и поаятный источник (`everyayahDir`) для офлайна, и
 * пословные тайминги — караоке-подсветка работает.
 *
 * ⚠️ Плата: у него 128 кбит/с против 64 у Аляфаси, а автозагрузка
 * (`audioAutoDownload`) качает весь Коран именно для чтеца по умолчанию.
 * То есть автоматическая загрузка примерно вдвое тяжелее — порядка 1.4 ГБ
 * вместо 0.7 ГБ.
 *
 * 🔴 Это принято СОЗНАТЕЛЬНО. Владельцу был предложен вариант «качать
 * лёгкого чтеца, а слушать Ясира» — он его прямо отклонил 04.09.2026:
 * «пусть качают». Не разводить автозагрузку и чтеца по умолчанию обратно:
 * скачивать одного, а слушать другого — значит держать на телефоне
 * гигабайт звука, который человек никогда не услышит.
 */
export const DEFAULT_RECITER: ReciterId = 'yasser';

/** Чтецы, у которых есть пословные тайминги.  Sync-источник истины для
 *  UI-чека (иначе ради одной проверки пришлось бы импортировать весь
 *  словарь QURAN_SEGMENTS в главный чанк).
 *
 *  Сейчас это чтецы каталога с проверенными пословными сегментами. Если
 *  добавляешь нового — сперва
 *  прогони scripts/gen/fetch-quran-segments.mjs, потом впиши id сюда. */
export const RECITERS_WITH_SEGMENTS: ReadonlySet<ReciterId> = new Set([
  'alafasy', 'shaatree', 'yasser',
]);

/** У Люхайдана и Аль-Аджми есть точные границы каждого аята, но нет
 * честных пословных сегментов. Вместо ложного караоке интерфейс отмечает
 * весь звучащий аят одной мягкой подложкой. */
export function usesWholeAyahHighlight(id: ReciterId): boolean {
  return id === 'luhaidan' || id === 'ajmi';
}

/**
 * Перемотка по времени вместо перехода по аятам.
 *
 * Флаг задаётся в каталоге явно, а не выводится из «нет таблицы границ»:
 * таблицы аятов весят мегабайты и живут в отдельных чанках, а этот признак
 * нужен главному чанку — плееру, ленте и экрану блокировки.
 */
export function usesTimelineSeek(id: ReciterId): boolean {
  return Boolean(reciterById(id).timelineOnly);
}

/** Есть ли у чтеца запись этой суры. */
export function reciterHasSurah(id: ReciterId, surah: number): boolean {
  const list = reciterById(id).availableSurahs;
  return !list || list.includes(surah);
}

/** Следующая после `surah` сура, которая есть у чтеца; null — дальше нет. */
export function nextAvailableSurah(id: ReciterId, surah: number): number | null {
  for (let n = surah + 1; n <= TOTAL_SURAHS; n++) {
    if (reciterHasSurah(id, n)) return n;
  }
  return null;
}

/** Предыдущая перед `surah` сура, которая есть у чтеца; null — раньше нет. */
export function prevAvailableSurah(id: ReciterId, surah: number): number | null {
  for (let n = surah - 1; n >= 1; n--) {
    if (reciterHasSurah(id, n)) return n;
  }
  return null;
}

/** Сколько сур есть у чтеца — цель «скачать всё» и шкала офлайна. */
export function availableSurahCount(id: ReciterId): number {
  return reciterById(id).availableSurahs?.length ?? TOTAL_SURAHS;
}

/** Шаг перемотки кнопками и с экрана блокировки — как у музыкальных плееров. */
export const TIMELINE_SEEK_STEP_SECONDS = 10;

/** Поаятное офлайн-хранилище принимает только отдельные mp3 каждого аята. */
export function supportsAyahOffline(id: ReciterId): boolean {
  const reciter = reciterById(id);
  return Boolean(reciter.ayahAudioBase || reciter.slug || reciter.everyayahDir);
}

/** Нужен ли для запуска выбранного аята большой файл всей суры.
 *
 * Если у чтеца есть отдельные MP3 аятов, холодный старт всегда идёт из
 * короткого файла выбранного аята. Это особенно важно в середине длинной
 * Аль-Бакары: браузеру не приходится открывать и перематывать 100+ МБ.
 * Посурный поток остаётся только fallback для будущего чтеца без
 * поаятного источника. */
/**
 * Есть ли у чтеца непрерывная запись суры целиком.
 *
 * Не то же самое, что `requiresSurahAudioStream`: та отвечает «другого
 * источника нет», а эта — «такой источник есть». Для непрерывного чтения
 * суры важна именно вторая: сплошной файл предпочтителен даже у чтецов, у
 * которых есть и поаятные записи.
 */
export function hasSurahAudio(id: ReciterId): boolean {
  return Boolean(reciterById(id).surahAudioBase);
}

export function requiresSurahAudioStream(id: ReciterId): boolean {
  const reciter = reciterById(id);
  const hasPerAyahSource = Boolean(
    reciter.ayahAudioBase || reciter.slug || reciter.everyayahDir,
  );
  return Boolean(reciter.surahAudioBase) && !hasPerAyahSource;
}

export function surahAudioUrl(id: ReciterId, surah: number): string | null {
  const reciter = reciterById(id);
  if (!reciter.surahAudioBase) return null;
  const filename = reciter.surahAudioPadded
    ? String(surah).padStart(3, '0')
    : String(surah);
  return `${reciter.surahAudioBase}/${filename}.mp3`;
}

export function reciterById(id: ReciterId): Reciter {
  return RECITERS.find(r => r.id === id) ?? RECITERS[0];
}
