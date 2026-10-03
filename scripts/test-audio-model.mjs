#!/usr/bin/env node
/**
 * test-audio-model.mjs — проверка арифметики офлайн-модели аудио.
 *
 * Почему это отдельный скрипт, а не vitest: единственное, что здесь
 * нужно проверять, — чистые функции без DOM и без React.  Ради них
 * тянуть тестовый раннер с полусотней зависимостей смысла нет, а
 * `node --experimental-strip-types` умеет импортировать .ts напрямую.
 *
 * Почему это вообще нужно. На нумерации аятов держится вся офлайн-
 * модель: сдвинется на единицу — приложение начнёт молча играть
 * не тот аят и складывать файлы не под теми именами. Такую ошибку
 * не видно ни в типах, ни в сборке, ни глазами на экране.
 *
 * Запуск:  npm test
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const mod = await import(pathToFileURL(resolve(ROOT, 'src/lib/ayahNumbering.ts')).href);
const searchMod = await import(pathToFileURL(resolve(ROOT, 'src/lib/search.ts')).href);
// Словарь переводов теперь грузится отдельным чанком (quran-sources-lazy.ts),
// чтобы не задерживать старт приложения. В приложении его прогревает App.tsx,
// здесь — прогреваем явно, иначе поиск по переводу честно ответит notReady.
await searchMod.ensureSearchReady();
const tajweedAudioMod = await import(
  pathToFileURL(resolve(ROOT, 'src/lib/tajweedAudioPosition.ts')).href
);
const tajweedPageMod = await import(
  pathToFileURL(resolve(ROOT, 'src/lib/tajweedPage.ts')).href
);
const recitersMod = await import(
  pathToFileURL(resolve(ROOT, 'src/lib/reciters.ts')).href
);
const quranUtilsMod = await import(
  pathToFileURL(resolve(ROOT, 'src/lib/quranUtils.ts')).href
);
const ayahAudioRangeMod = await import(
  pathToFileURL(resolve(ROOT, 'src/lib/ayahAudioRange.ts')).href
);
const prayerCitiesMod = await import(
  pathToFileURL(resolve(ROOT, 'src/lib/prayerCities.ts')).href
);
const prayerPreferencesMod = await import(
  pathToFileURL(resolve(ROOT, 'src/lib/prayerPreferences.ts')).href
);
const prayerNotificationsMod = await import(
  pathToFileURL(resolve(ROOT, 'src/lib/prayerNotifications.ts')).href
);
const timetableMod = await import(
  pathToFileURL(resolve(ROOT, 'src/content/nazranPrayerTimetables.ts')).href
);
const {
  globalAyahNumber, ayahsInSurah, firstGlobalOfSurah, juzRange,
  TOTAL_AYAHS, TOTAL_SURAHS,
} = mod;
const { tajweedVisualWordPosition } = tajweedAudioMod;
const { tajweedPageJsonPath, tajweedAyahFromPage } = tajweedPageMod;
const {
  RECITERS, RECITERS_WITH_SEGMENTS, reciterById, supportsAyahOffline,
  requiresSurahAudioStream, surahAudioUrl, usesWholeAyahHighlight,
} = recitersMod;
const { ayahAudioUrl } = quranUtilsMod;
const { ayahAudioRange } = ayahAudioRangeMod;
const { timetableRow, timetableDays } = timetableMod;
const { settingsForNewPrayerPlace } = prayerCitiesMod;
const {
  normalisePrimaryPrayerSource,
  DEFAULT_PRIMARY_PRAYER_SOURCE,
} = prayerPreferencesMod;
const {
  normalisePrayerAlarms,
  buildPrayerAlarmOccurrences,
  PRAYER_ALARM_KEYS,
} = prayerNotificationsMod;

let passed = 0;
const failures = [];

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; return; }
  failures.push(`${name}\n      получено:  ${JSON.stringify(got)}\n      ожидалось: ${JSON.stringify(want)}`);
}

function group(title, fn) {
  console.log(`\n  ${title}`);
  const before = failures.length;
  fn();
  const bad = failures.length - before;
  console.log(bad === 0 ? '    ✓' : `    ✗ ${bad}`);
}

async function groupAsync(title, fn) {
  console.log(`\n  ${title}`);
  const before = failures.length;
  await fn();
  const bad = failures.length - before;
  console.log(bad === 0 ? '    ✓' : `    ✗ ${bad}`);
}

// ─── Аудиопозиции цветного таджвида ──────────────────────────────────
group('Цветной таджвид: аудиопозиция совпадает с видимым словом', () => {
  check('обычный аят сохраняет позицию без изменений',
    tajweedVisualWordPosition('1:1', 3), 3);
  check('37:130 — третья позиция подсвечивает объединённый глиф',
    tajweedVisualWordPosition('37:130', 3), 3);
  check('37:130 — четвёртая позиция остаётся на том же объединённом глифе',
    tajweedVisualWordPosition('37:130', 4), 3);
  check('нет активного слова — нет подсветки',
    tajweedVisualWordPosition('37:130', null), null);
});

group('Лента аятов: быстрый постраничный таджвид', () => {
  const page2 = JSON.parse(readFileSync(resolve(ROOT, 'public/tajweed/pages/002.json'), 'utf8'));
  const ayah = tajweedAyahFromPage(page2, '2:3');
  check('аят собирается из JSON одной страницы',
    [ayah?.surah, ayah?.ayah, ayah?.page], [2, 3, 2]);
  check('слова отделены от конечной розетки',
    [ayah?.words.length, ayah?.endMarker], [8, 'ﱕ']);
  check('отсутствующий аят не подменяется чужими данными',
    tajweedAyahFromPage(page2, '1:1'), null);
  check('путь страницы дополнен нулями',
    tajweedPageJsonPath(7), '/tajweed/pages/007.json');
});

group('Каталог чтецов и источники аудио', () => {
  check('в каталоге пять проверенных чтецов',
    RECITERS.map(reciter => reciter.id),
    ['alafasy', 'shaatree', 'yasser', 'luhaidan', 'ajmi']);
  check('Ясир Ад-Даусари подписан по-русски и по-арабски',
    [reciterById('yasser').label, reciterById('yasser').arabic],
    ['Ясир Ад-Даусари', 'ياسر الدوسري']);
  check('URL Ад-Даусари использует отдельный файл нужного аята',
    ayahAudioUrl(2, 255, 'yasser'),
    'https://everyayah.com/data/Yasser_Ad-Dussary_128kbps/002255.mp3');
  check('непрерывная запись Ад-Даусари использует файл полной суры',
    surahAudioUrl('yasser', 2),
    'https://download.quranicaudio.com/quran/yasser_ad-dussary/002.mp3');
  check('холодный запуск Ад-Даусари не открывает файл всей суры',
    requiresSurahAudioStream('yasser'), false);
  check('для Ад-Даусари включены собственные пословные тайминги',
    RECITERS_WITH_SEGMENTS.has('yasser'), true);
  check('Люхайдан подписан по-русски и по-арабски',
    [reciterById('luhaidan').label, reciterById('luhaidan').arabic],
    ['Мухаммад Аль-Люхайдан', 'محمد اللحيدان']);
  check('URL Люхайдана указывает на короткий файл выбранного аята',
    ayahAudioUrl(2, 255, 'luhaidan'),
    'https://l.asrbook.ru/audio/luhaidan/002/255.mp3');
  check('исходная непрерывная запись Люхайдана остаётся воспроизводимой',
    surahAudioUrl('luhaidan', 2),
    'https://server8.mp3quran.net/lhdan/002.mp3');
  check('Люхайдан начинает 2:255 по локальной точной границе',
    ayahAudioRange('luhaidan', 2, 255),
    { startSeconds: 5729.187, endSeconds: 5781.676 });
  let luhaidanRangeCount = 0;
  let invalidLuhaidanRanges = 0;
  for (let surah = 1; surah <= TOTAL_SURAHS; surah++) {
    for (let ayah = 1; ayah <= ayahsInSurah(surah); ayah++) {
      const range = ayahAudioRange('luhaidan', surah, ayah);
      if (!range) invalidLuhaidanRanges++;
      else {
        luhaidanRangeCount++;
        if (range.startSeconds < 0 || range.endSeconds <= range.startSeconds) {
          invalidLuhaidanRanges++;
        }
      }
    }
  }
  check('у Люхайдана есть валидная граница каждого из 6236 аятов',
    [luhaidanRangeCount, invalidLuhaidanRanges], [TOTAL_AYAHS, 0]);
  check('короткие файлы Люхайдана доступны для поаятной офлайн-загрузки',
    supportsAyahOffline('luhaidan'), true);
  check('холодный запуск Люхайдана не открывает файл всей суры',
    requiresSurahAudioStream('luhaidan'), false);
  check('Люхайдан использует честную подсветку целого аята без пословных таймингов',
    usesWholeAyahHighlight('luhaidan'), true);
  check('чтец с пословными таймингами сохраняет караоке-подсветку',
    usesWholeAyahHighlight('alafasy'), false);
  check('Аль-Аджми подписан по-русски и по-арабски',
    [reciterById('ajmi').label, reciterById('ajmi').arabic],
    ['Ахмад Аль-Аджми', 'أحمد بن علي العجمي']);
  check('URL Аль-Аджми использует отдельный 128 kbps файл аята',
    ayahAudioUrl(2, 255, 'ajmi'),
    'https://everyayah.com/data/Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net/002255.mp3');
  check('непрерывная запись Аль-Аджми использует файл полной суры',
    surahAudioUrl('ajmi', 2),
    'https://download.quranicaudio.com/quran/ahmed_ibn_3ali_al-3ajamy/002.mp3');
  check('Аль-Аджми доступен для поаятной офлайн-загрузки',
    supportsAyahOffline('ajmi'), true);
  check('холодный запуск Аль-Аджми использует отдельный MP3 аята',
    requiresSurahAudioStream('ajmi'), false);
  check('Аль-Аджми не заявляет отсутствующую пословную синхронизацию',
    RECITERS_WITH_SEGMENTS.has('ajmi'), false);
  check('Аль-Аджми подсвечивает целиком точный звучащий аят',
    usesWholeAyahHighlight('ajmi'), true);
  check('оценка офлайн-размера учитывает 128 kbps Ад-Даусари',
    reciterById('yasser').bitrateKbps / reciterById('alafasy').bitrateKbps, 2);

  let continuousRangeCount = 0;
  let invalidContinuousRanges = 0;
  for (const reciter of RECITERS) {
    for (let surah = 1; surah <= TOTAL_SURAHS; surah++) {
      for (let ayah = 1; ayah <= ayahsInSurah(surah); ayah++) {
        const range = ayahAudioRange(reciter.id, surah, ayah);
        if (!range) invalidContinuousRanges++;
        else {
          continuousRangeCount++;
          if (range.startSeconds < 0 || range.endSeconds <= range.startSeconds) {
            invalidContinuousRanges++;
          }
        }
      }
    }
  }
  check('у всех пяти чтецов есть валидные границы для бесшовных 6236 аятов',
    [continuousRangeCount, invalidContinuousRanges],
    [TOTAL_AYAHS * RECITERS.length, 0]);
});

group('iOS: стабильная подсветка QCF-глифов', () => {
  const qcfSource = readFileSync(
    resolve(ROOT, 'src/components/QcfAyahLine.tsx'), 'utf8',
  );
  const cssSource = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8');
  check('QCF-рендерер не монтирует движущийся AyahGlowLayer',
    qcfSource.includes('<AyahGlowLayer'), false);
  check('glow не применяет text-shadow к активному QCF-глифу',
    cssSource.includes(
      '[data-highlight-style="glow"] .qcf-word-glyph[data-active-word] {'
    ) && cssSource.includes('text-shadow: none !important;'), true);
});

group('iOS: основной штрих цветного таджвида следует теме', () => {
  const fontFetcher = readFileSync(
    resolve(ROOT, 'scripts/gen/fetch-tajweed-data.ts'), 'utf8',
  );
  const fontLoader = readFileSync(
    resolve(ROOT, 'src/hooks/useTajweedFont.ts'), 'utf8',
  );
  const paletteSource = readFileSync(
    resolve(ROOT, 'src/lib/tajweedPalette.ts'), 'utf8',
  );
  const tajweedAyahSource = readFileSync(
    resolve(ROOT, 'src/components/TajweedAyah.tsx'), 'utf8',
  );
  const appCss = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8');
  check('runtime использует неизменённые официальные COLR v0/CPAL-файлы',
    fontFetcher.includes('official COLR v0/CPAL files')
      && fontFetcher.includes('Keep the downloaded font binaries intact'), true);
  check('URL шрифта меняется и не оставляет старый монохромный font cache',
    fontLoader.includes(
      "TAJWEED_FONT_VERSION = 'official-colrv0-cpal-v6'"
    )
      && fontLoader.includes('?v=${TAJWEED_FONT_VERSION}'), true);
  check('светлая и тёмная темы выбирают официальные палитры 0 и 1',
    paletteSource.includes("{ dark: 1, light: 0 }"), true);
  check('монохромный fallback получает цвет активной темы',
    appCss.includes('.tajweed-theme-ink {')
      && appCss.includes('color: var(--text-primary);'), true);
  check('Tajweed-рендерер ленты использует единое правило чернил темы',
    tajweedAyahSource.includes('className="tajweed-theme-ink"'), true);
});

group('Готовые расписания намаза для Назрани', () => {
  check('по умолчанию первым открывается Назрань 1',
    normalisePrimaryPrayerSource(null), DEFAULT_PRIMARY_PRAYER_SOURCE);
  check('выбранное основное расписание сохраняет допустимый источник',
    ['nazran-1', 'nazran-2', 'calculated'].map(normalisePrimaryPrayerSource),
    ['nazran-1', 'nazran-2', 'calculated']);
  const ids = ['nazran-1', 'nazran-2'];
  const keys = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  let invalidRows = 0;
  for (const id of ids) {
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= timetableDays(id, month); day++) {
        const row = timetableRow(id, month, day);
        const minutes = keys.map(key => {
          const value = row?.[key] ?? '';
          const match = /^(\d{2}):(\d{2})$/.exec(value);
          return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
        });
        if (minutes.some(value => !Number.isFinite(value))
          || minutes.some((value, index) => index > 0 && value <= minutes[index - 1])) {
          invalidRows++;
        }
      }
    }
  }

  check('«Назрань 1» содержит 365 дней',
    Array.from({ length: 12 }, (_, i) => timetableDays('nazran-1', i + 1)).reduce((a, b) => a + b, 0),
    365);
  check('«Назрань 2» содержит 365 дней',
    Array.from({ length: 12 }, (_, i) => timetableDays('nazran-2', i + 1)).reduce((a, b) => a + b, 0),
    365);
  check('в каждой строке шесть последовательных времён', invalidRows, 0);
  check('первая строка «Назрань 1» перенесена дословно', timetableRow('nazran-1', 1, 1), {
    fajr: '06:05', sunrise: '07:25', dhuhr: '12:20',
    asr: '14:20', maghrib: '16:42', isha: '18:12',
  });
  check('первая строка «Назрань 2» перенесена дословно', timetableRow('nazran-2', 1, 1), {
    fajr: '06:01', sunrise: '07:35', dhuhr: '12:10',
    asr: '14:18', maghrib: '16:36', isha: '18:02',
  });
  check('исправлена распознанная иша 8 декабря', timetableRow('nazran-1', 12, 8)?.isha, '18:02');
  check('в «Назрань 1» нет отсутствующего в источнике 29 февраля', timetableRow('nazran-1', 2, 29), null);
  check('в «Назрань 2» нет отсутствующего в источнике 31 марта', timetableRow('nazran-2', 3, 31), null);
  check('новая Назрань по умолчанию открывает первое готовое расписание',
    settingsForNewPrayerPlace({ lat: 43.2256, lon: 44.7642 }).source, 'nazran-1');
  check('другой новый город остаётся в режиме расчёта',
    settingsForNewPrayerPlace({ lat: 55.7558, lon: 37.6173 }).source, 'calculated');
});

group('Отдельные напоминания о намазах', () => {
  check('все напоминания по умолчанию выключены',
    Object.values(normalisePrayerAlarms(null)), [false, false, false, false, false]);
  check('восход не получает отдельный будильник',
    PRAYER_ALARM_KEYS, ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);

  const place = { name: 'Назрань', lat: 43.22597, lon: 44.77323, source: 'manual' };
  const city = {
    id: 'alarm-test',
    ...place,
    settings: { ...settingsForNewPrayerPlace(place), source: 'nazran-1' },
  };
  const alarms = normalisePrayerAlarms({
    fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true,
  });
  const occurrences = buildPrayerAlarmOccurrences(
    city, alarms, new Date(2026, 7, 13, 0, 0, 0), 1,
  );
  check('на один день планируются ровно пять намазов',
    occurrences.map(item => item.key), PRAYER_ALARM_KEYS);
  check('идентификаторы напоминаний не пересекаются',
    new Set(occurrences.map(item => item.id)).size, occurrences.length);
});

// ─── Сквозная нумерация ───────────────────────────────────────────────
group('Сквозная нумерация аятов', () => {
  check('1:1 — первый аят Корана', globalAyahNumber(1, 1), 1);
  check('1:7 — конец Аль-Фатихи', globalAyahNumber(1, 7), 7);
  check('2:1 — начало Аль-Бакары', globalAyahNumber(2, 1), 8);
  check('2:255 — аят аль-Курси', globalAyahNumber(2, 255), 262);
  check('2:286 — конец Аль-Бакары', globalAyahNumber(2, 286), 293);
  check('114:6 — последний аят Корана', globalAyahNumber(114, 6), TOTAL_AYAHS);

  let sum = 0;
  for (let s = 1; s <= TOTAL_SURAHS; s++) sum += ayahsInSurah(s);
  check('сумма длин 114 сур = 6236', sum, TOTAL_AYAHS);

  check('ayahsInSurah вне диапазона', [ayahsInSurah(0), ayahsInSurah(115)], [0, 0]);
});

// ─── Границы сур ──────────────────────────────────────────────────────
group('Суры стыкуются без дыр и нахлёстов', () => {
  let gaps = 0;
  for (let s = 1; s <= TOTAL_SURAHS; s++) {
    const last = firstGlobalOfSurah(s) + ayahsInSurah(s) - 1;
    const expectedNext = s === TOTAL_SURAHS ? TOTAL_AYAHS : firstGlobalOfSurah(s + 1) - 1;
    if (last !== expectedNext) gaps++;
  }
  check('разрывов между сурами', gaps, 0);
  check('первая сура начинается с 1', firstGlobalOfSurah(1), 1);

  // Обратная проверка: каждый сквозной номер принадлежит ровно одной суре.
  const seen = new Uint8Array(TOTAL_AYAHS + 1);
  for (let s = 1; s <= TOTAL_SURAHS; s++) {
    for (let a = 1; a <= ayahsInSurah(s); a++) seen[globalAyahNumber(s, a)]++;
  }
  let notOnce = 0;
  for (let n = 1; n <= TOTAL_AYAHS; n++) if (seen[n] !== 1) notOnce++;
  check('каждый номер 1..6236 покрыт ровно один раз', notOnce, 0);
});

// ─── Джузы ────────────────────────────────────────────────────────────
group('Джузы покрывают Коран без дыр', () => {
  check('джуз 1 начинается с первого аята', juzRange(1)[0], 1);
  check('джуз 1 кончается перед 2:142', juzRange(1)[1], globalAyahNumber(2, 142) - 1);
  check('джуз 30 начинается с 78:1', juzRange(30)[0], globalAyahNumber(78, 1));
  check('джуз 30 кончается последним аятом', juzRange(30)[1], TOTAL_AYAHS);

  let prev = 0, broken = 0;
  for (let j = 1; j <= 30; j++) {
    const [from, to] = juzRange(j);
    if (from !== prev + 1 || to < from) broken++;
    prev = to;
  }
  check('30 джузов идут встык', broken, 0);
  check('последний джуз доходит до конца', prev, TOTAL_AYAHS);

  check('juz(0) и juz(99) зажимаются в диапазон',
    [juzRange(0)[0], juzRange(99)[1]], [1, TOTAL_AYAHS]);
});

// ─── Битовая карта ────────────────────────────────────────────────────
group('Битовая карта скачанного', () => {
  const BYTES = Math.ceil(TOTAL_AYAHS / 8);
  check('размер карты в байтах', BYTES, 780);

  const map = new Uint8Array(BYTES);
  const set = n => { const i = n - 1; map[i >> 3] |= (1 << (i & 7)); };
  const has = n => { const i = n - 1; return (map[i >> 3] & (1 << (i & 7))) !== 0; };
  const popcount = () => {
    let n = 0;
    for (let b = 0; b < map.length; b++) { let v = map[b]; while (v) { v &= v - 1; n++; } }
    return n;
  };

  check('пустая карта', popcount(), 0);

  // Главный сценарий, который ломала прошлая модель «скачано до N»:
  // произвольная дырявая выборка посреди длинной суры.
  set(globalAyahNumber(2, 150));
  set(globalAyahNumber(2, 152));
  check('2:150 есть', has(globalAyahNumber(2, 150)), true);
  check('2:151 НЕТ — дырка допустима', has(globalAyahNumber(2, 151)), false);
  check('2:152 есть', has(globalAyahNumber(2, 152)), true);
  check('счётчик после двух отметок', popcount(), 2);

  set(1);
  set(TOTAL_AYAHS);
  check('границы диапазона', [has(1), has(TOTAL_AYAHS)], [true, true]);
  check('за границей ничего не задето', has(TOTAL_AYAHS + 1) === true, false);

  // Полная карта
  const full = new Uint8Array(BYTES).fill(0xff);
  let cnt = 0;
  for (let n = 1; n <= TOTAL_AYAHS; n++) {
    const i = n - 1;
    if ((full[i >> 3] & (1 << (i & 7))) !== 0) cnt++;
  }
  check('полная карта покрывает все 6236', cnt, TOTAL_AYAHS);

  // base64 round-trip — так карта хранится в Preferences
  const b64 = Buffer.from(map).toString('base64');
  const back = new Uint8Array(Buffer.from(b64, 'base64'));
  check('base64 туда-обратно', Array.from(back).join(), Array.from(map).join());
  check('карта в base64 занимает ~1 КБ', b64.length, 1040);
});

// ─── Полнота суры ─────────────────────────────────────────────────────
group('Определение «сура скачана целиком»', () => {
  const BYTES = Math.ceil(TOTAL_AYAHS / 8);
  const map = new Uint8Array(BYTES);
  const set = n => { const i = n - 1; map[i >> 3] |= (1 << (i & 7)); };
  const has = n => { const i = n - 1; return (map[i >> 3] & (1 << (i & 7))) !== 0; };
  const inSurah = s => {
    let n = 0;
    const first = firstGlobalOfSurah(s);
    for (let k = 0; k < ayahsInSurah(s); k++) if (has(first + k)) n++;
    return n;
  };

  for (let a = 1; a <= 7; a++) set(globalAyahNumber(1, a));
  check('Аль-Фатиха: 7 из 7', inSurah(1), 7);
  check('Аль-Фатиха целиком', inSurah(1) === ayahsInSurah(1), true);
  check('соседняя сура не задета', inSurah(2), 0);

  // Крайний случай: последняя сура у самой границы карты
  for (let a = 1; a <= ayahsInSurah(114); a++) set(globalAyahNumber(114, a));
  check('Ан-Нас целиком у границы', inSurah(114) === ayahsInSurah(114), true);
  check('предыдущая сура не задета', inSurah(113), 0);
});

// ─── Поиск по переводу ────────────────────────────────────────────────
group('Поиск по русскому переводу', () => {
  const { search, snippet, normalise } = searchMod;

  check('нормализация: регистр и ё',
    normalise('ЕЁ Господу, миров!'), 'ее господу миров');
  check('нормализация: пустой запрос', normalise('  ,,, '), '');

  const g = search('Господу миров');
  check('«Господу миров» находит аяты', g.ayahs.length > 0, true);
  check('первый результат — 1:2 (Аль-Фатиха)',
    [g.ayahs[0].surah, g.ayahs[0].ayah], [1, 2]);

  // Подсветка обязана быть куском ОРИГИНАЛА, а не нормализованной
  // строки — иначе пользователь увидит покалеченную цитату.
  const h = g.ayahs[0];
  const s = snippet(h);
  check('подсветка вырезана из оригинала',
    h.text.slice(h.matchStart, h.matchEnd), s.match);
  check('подсветка совпадает с запросом без учёта регистра',
    normalise(s.match), normalise('Господу миров'));

  // ё и е — одна буква
  check('«ее» и «её» дают одинаковое число совпадений',
    search('еесли').ayahs.length, search('еёсли').ayahs.length);
  const yo = search('Аллаху');
  check('поиск с заглавной буквы работает', yo.ayahs.length > 0, true);
  check('он же строчными даёт столько же',
    search('аллаху').ayahs.length, yo.ayahs.length);

  // Слишком короткий запрос по переводу не идёт
  const short = search('ее');
  check('запрос короче трёх букв не ищет по переводу',
    [short.ayahs.length, short.tooShortForText], [0, true]);

  // Поиск сур
  check('сура по номеру', search('2').surahs.map(x => x.number), [2]);
  check('сура по названию', search('Фатиха').surahs.map(x => x.number), [1]);
  check('сура по переводу названия', search('Корова').surahs.map(x => x.number), [2]);
  check('пустой запрос — пустой результат',
    [search('').surahs.length, search('').ayahs.length], [0, 0]);
  check('бессмысленный запрос ничего не находит',
    [search('ыфваыфва').surahs.length, search('ыфваыфва').ayahs.length], [0, 0]);

  // Ограничение выдачи
  const many = search('и');
  check('однобуквенный запрос не выдаёт полкорана', many.ayahs.length, 0);
  const common = search('Аллах');
  check('частое слово обрезается до лимита', common.ayahs.length <= 60, true);
  check('и помечается как обрезанное', common.truncated, true);

  // Выдача — это оглавление: сверху вниз по Корану.  Раньше список
  // склеивался из двух корзин («с начала слова» и «внутри слова»), и
  // порядок рвался на стыке — аят из 2-й суры оказывался ниже аята
  // из 27-й.  Проверяем на нескольких запросах, а не на одном:
  // поломка проявлялась только там, где есть совпадения обоих видов.
  for (const q of ['бойся', 'страх', 'молитв', 'terpen', 'вода', 'сердце']) {
    const r = search(q);
    const nums = r.ayahs.map(a => globalAyahNumber(a.surah, a.ayah));
    const sorted = [...nums].sort((x, y) => x - y);
    check(`«${q}» — выдача в порядке мусхафа`, nums, sorted);
  }

  // Каждый аят попадает в выдачу один раз: при двух корзинах дубль
  // был бы возможен, если бы условия пересеклись.
  const dup = search('Аллах');
  check('в выдаче нет повторов аятов',
    new Set(dup.ayahs.map(a => a.surah + ':' + a.ayah)).size, dup.ayahs.length);
});

// ─── Ингушский перевод ────────────────────────────────────────────────
//
// Что показывается под аятом и как его найти.  Сам текст перевода
// дословно из источника (data/inh-quran), здесь проверяется только
// фильтр показа и правила сравнения в поиске.
const inhMod = await import(pathToFileURL(resolve(ROOT, 'src/lib/inhTranslation.ts')).href);
const lazySourcesMod = await import(pathToFileURL(resolve(ROOT, 'src/content/quran-sources-lazy.ts')).href);
group('Ингушский перевод: показ и поиск', () => {
  const { inhDisplayText } = inhMod;
  const { search, snippet, normalise } = searchMod;
  const sources = lazySourcesMod.getQuranSources();
  const raw = k => sources[k].translations.inh;

  // Показ: обычный аят — как есть, символ в символ.
  check('1:1 показывается дословно', inhDisplayText('1:1', raw('1:1')), raw('1:1'));
  // Хвост после <p> — не перевод этого аята.
  check('20:32: без тега <p>',
    inhDisplayText('20:32', raw('20:32')), raw('20:32').slice(0, raw('20:32').indexOf('<p>')).trimEnd());
  check('50:40: без приклеенного перевода 50:41',
    inhDisplayText('50:40', raw('50:40')).includes('41.'), false);
  // Сдвиг в конце суры 50 — не показываем, пока владелец не решил.
  check('50:41–50:44 скрыты',
    ['50:41', '50:42', '50:43', '50:44'].map(k => inhDisplayText(k, raw(k))),
    [undefined, undefined, undefined, undefined]);
  check('50:45 пуст в источнике', inhDisplayText('50:45', raw('50:45')), undefined);

  // По всему Корану: на экран не попадает разметка, символы приватной
  // зоны (квадраты) и арабские обрывки.
  const bad = Object.keys(sources).filter(k => {
    const t = inhDisplayText(k, raw(k));
    return t !== undefined && /[<>\uE000-\uF8FF\u0600-\u06FF]/.test(t);
  });
  check('ни одного показанного аята с мусором источника', bad, []);
  const shown = Object.keys(sources).filter(k => inhDisplayText(k, raw(k)) !== undefined).length;
  check('ингушский показывается в 6231 аяте (6236 − 50:41…50:45)', shown, 6231);

  // Поиск: ингушский находится, подсветка — из оригинала.
  const kh = search('Къахетам беши');
  check('ингушский запрос находит 1:1 первым',
    [kh.ayahs[0].surah, kh.ayahs[0].ayah, kh.ayahs[0].lang], [1, 1, 'inh']);

  // Палочку набирают тремя способами — все должны находить 67:1.
  for (const q of ['ЦIена ва мулк', 'ЦӀена ва мулк', 'ц1ена ва мулк']) {
    const r = search(q);
    check(`«${q}» находит 67:1`,
      r.ayahs.some(a => a.surah === 67 && a.ayah === 1 && a.lang === 'inh'), true);
  }

  // Знак ударения в источнике («Алла́хIа») не мешает поиску без него,
  // а подсветка захватывает исходный текст вместе с ударением.
  const acc = search('аллахIа цIерца');
  check('запрос без ударения находит 1:1', [acc.ayahs[0].surah, acc.ayahs[0].ayah], [1, 1]);
  const accSnip = snippet(acc.ayahs[0]);
  check('подсветка — кусок оригинала с ударением',
    accSnip.match, acc.ayahs[0].text.slice(acc.ayahs[0].matchStart, acc.ayahs[0].matchEnd));
  check('…и ударение в ней сохранено', accSnip.match.includes('́'), true);

  // Латинские двойники внутри кириллических слов источника: «cийле»
  // (62:4, латинская c) и «Mи́м» (44:1, латинская M и ударение).
  check('«сийле я» (кириллицей) находит 62:4 с латинской «c»',
    search('сийле я').ayahs.some(a => a.surah === 62 && a.ayah === 4 && a.lang === 'inh'), true);
  check('«Хьа. Мим» находит 44:1 с латинской «M» и ударением',
    search('Хьа. Мим').ayahs.some(a => a.surah === 44 && a.ayah === 1 && a.lang === 'inh'), true);
  // Палочку набирают и украинской «і».
  check('«Ціена ва мулк» (украинская і) находит 67:1',
    search('Ціена ва мулк').ayahs.some(a => a.surah === 67 && a.ayah === 1), true);

  // Поиск только по видимым переводам.
  check('скрытый русский не ищется: «Господу миров» только в ингушском — пусто',
    search('Господу миров', { langs: ['inh'] }).ayahs.length, 0);
  check('скрытый ингушский не ищется: «Къахетам беши» только в русском — пусто',
    search('Къахетам беши', { langs: ['ru'] }).ayahs.length, 0);
  const ruOnly = search('Аллах', { langs: ['ru'] });
  check('при одном русском все результаты русские',
    ruOnly.ayahs.every(a => a.lang === 'ru'), true);

  // Скрытые записи не находятся: иначе поиск привёл бы к чужому переводу.
  const hidden = search('хьахозача дийнахьа');
  check('текст скрытого 50:41 не находится как 50:41',
    hidden.ayahs.some(a => a.surah === 50 && a.ayah === 41), false);

  // Русский поиск не сломан складыванием символов.
  const ru = search('Господу миров');
  check('русский запрос по-прежнему находит 1:2',
    [ru.ayahs[0].surah, ru.ayahs[0].ayah, ru.ayahs[0].lang], [1, 2, 'ru']);
  check('«й» не превращается в «и»', normalise('Мой Господь'), 'мой господь');
  check('цифры вне кириллицы остаются цифрами', normalise('2 255'), '2 255');

  // Аят, найденный в обоих переводах, — один результат.
  const both = search('Аллах');
  check('в выдаче нет повторов при поиске по двум переводам',
    new Set(both.ayahs.map(a => a.surah + ':' + a.ayah)).size, both.ayahs.length);
});

// ─── Время намаза ─────────────────────────────────────────────────────
//
// Зачем это здесь.  Время намаза — не косметика: ошибка в углах или
// потерянная поправка означают намаз не в своё время, и увидеть это
// на экране невозможно — цифры выглядят правдоподобно любыми.
//
// Никаких «запасов» приложение от себя не добавляет: считается чистая
// астрономия по углам выбранного метода, и только поверх неё ложится
// ручная поправка, которую человек выставил сам.
const prayerMod = await import(pathToFileURL(resolve(ROOT, 'src/lib/prayerTimes.ts')).href);
const {
  timesFor, nextPrayer, methodById, DEFAULT_SETTINGS,
  ZERO_ADJUSTMENTS, METHODS, PRAYER_ORDER, IS_PRAYER,
} = prayerMod;

const NAZRAN = { lat: 43.2256, lon: 44.7642 };
// Часовой пояс задаём явно: тест не должен зависеть от настроек
// машины, на которой его запускают.
const hhmm = d => d.toLocaleTimeString('ru-RU', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
});

/**
 * Момент времени по назрановским часам.
 *
 * Назрань живёт по московскому времени: UTC+3 круглый год, перевода стрелок
 * в России нет с 2014-го. Строить здесь `new Date(y, m, d, h, mm)` нельзя —
 * это время в поясе МАШИНЫ. Ровно на этом тесты и падали: сервер переставили
 * с UTC на America/Chicago, и «08:00» превратилось в 16:00 по Назрани, то
 * есть следующим намазом оказывался магриб вместо зухра.
 *
 * Форматирование пояс уже фиксировало (hhmm выше), а построение момента —
 * нет. Теперь обе стороны сравнения не зависят от машины.
 */
// ⚠️ Прогон закреплён на TZ=Europe/Moscow в package.json, и это не
// перестраховка. `timesFor` определяет, ЗА КАКОЙ ДЕНЬ считать времена, по
// календарной дате в поясе МАШИНЫ (`date.getMonth()`, `date.getDate()`, и
// так же поступает adhan). Для человека, который находится в своём городе,
// это верно: «сегодня» — это его сегодня. Но тест, запущенный в чужом
// поясе, получал времена не того дня, и «ближайший намаз» уезжал.
//
// Пояс машины и пояс Назрани должны совпадать — иначе проверяется не то,
// что подразумевалось. Закрепление в package.json делает это явным и
// одинаковым везде: на сервере, у владельца и на раннере GitHub.
const MOSCOW_OFFSET_HOURS = 3;
const nazranMoment = (h = 0, m = 0) =>
  new Date(Date.UTC(2026, 7, 11, h - MOSCOW_OFFSET_HOURS, m));

group('Время намаза — расчёт по углам', () => {
  const DAY = nazranMoment(12, 0);   // полдень по Назрани — дата однозначна
  const KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const table = s => KEYS.map(k => hhmm(timesFor(NAZRAN, DAY, s)[k]));

  check('дефолт — ДУМ России, шафиитский аср',
    [DEFAULT_SETTINGS.method, DEFAULT_SETTINGS.madhab], ['dumrf', 'shafi']);

  // Чистая астрономия для Назрани на 11 августа 2026 при 16°/15°.
  check('16°/15° дают ожидаемый день',
    table(DEFAULT_SETTINGS),
    ['03:24', '05:02', '12:06', '16:00', '19:10', '20:40']);

  // Углы метода обязаны реально влиять на результат: 18° против 16°
  // сдвигают фаджр на четверть часа.
  check('18° сдвигают фаджр на пятнадцать минут',
    table({ ...DEFAULT_SETTINGS, method: 'mwl' })[0], '03:09');

  check('ханафитский аср отличается на час',
    table({ ...DEFAULT_SETTINGS, madhab: 'hanafi' })[3], '17:04');

  check('ручная поправка сдвигает время',
    table({ ...DEFAULT_SETTINGS, adjustments: { ...ZERO_ADJUSTMENTS, dhuhr: -2 } })[2],
    '12:04');

  check('поправка у одного намаза не трогает соседние',
    table({ ...DEFAULT_SETTINGS, adjustments: { ...ZERO_ADJUSTMENTS, dhuhr: -2 } })[3],
    '16:00');

  // Приложение не должно молча прибавлять минуты к времени поклонения:
  // без ручной поправки результат обязан быть чистой астрономией.
  check('без ручной поправки ничего не прибавляется',
    table({ ...DEFAULT_SETTINGS, adjustments: ZERO_ADJUSTMENTS })[2], '12:06');

  check('все методы имеют указание источника',
    METHODS.every(m => typeof m.source === 'string' && m.source.length > 10), true);

  check('идентификаторы методов уникальны',
    new Set(METHODS.map(m => m.id)).size, METHODS.length);

  check('метод муфтията Ингушетии на месте',
    [methodById('ingushetia').fajr, methodById('ingushetia').isha.angle], [16, 16]);
});

group('Время намаза — ближайший намаз', () => {
  const at = (h, m) => nazranMoment(h, m);

  check('в 08:00 следующий — зухр',
    nextPrayer(NAZRAN, at(8, 0), DEFAULT_SETTINGS).key, 'dhuhr');

  // Восход не намаз, а граница времени фаджра: отсчёт «до восхода»
  // вводил бы в заблуждение.
  check('в 04:00 следующий не восход, а зухр',
    nextPrayer(NAZRAN, at(4, 0), DEFAULT_SETTINGS).key, 'dhuhr');

  check('восход помечен как не-намаз',
    [IS_PRAYER.sunrise, PRAYER_ORDER.includes('sunrise')], [false, true]);

  const after = nextPrayer(NAZRAN, at(23, 30), DEFAULT_SETTINGS);
  check('после иши экран не пустеет — берётся завтрашний фаджр',
    [after.key, after.tomorrow], ['fajr', true]);
  check('завтрашний фаджр действительно завтра',
    after.at.getTime() > at(23, 30).getTime(), true);
});

// ─── Города намаза ────────────────────────────────────────────────────
//
// Список городов и их настройки — то, что человек собирает руками и
// теряет молча: ошибка в разборе хранилища не видна ни в типах, ни на
// экране, пока однажды не сбросятся все поправки.
//
// Модуль работает с localStorage, поэтому подставляем минимальную
// заглушку ДО импорта: модуль читает хранилище на первом обращении.
globalThis.localStorage = (() => {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
})();
globalThis.window = {
  localStorage: globalThis.localStorage,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
};
globalThis.Event = class { constructor(type) { this.type = type; } };

const citiesMod = await import(pathToFileURL(resolve(ROOT, 'src/lib/prayerCities.ts')).href);
const {
  readCities, writeCities, readActiveId, setActiveId,
  addCity, removeCity, moveCity, updateCitySettings, MAX_CITIES,
} = citiesMod;

group('Города намаза', () => {
  localStorage.clear();

  // Первый запуск: переносим прежнее одиночное место и досыпаем пресеты,
  // названные владельцем.
  const seeded = readCities();
  check('на первом запуске город не один', seeded.length >= 4, true);
  check('первым идёт Назрань', seeded[0].name, 'Назрань');
  check('пресеты владельца на месте',
    ['Малгобек', 'Владикавказ', 'Москва'].every(n => seeded.some(c => c.name === n)), true);
  check('дублей нет',
    new Set(seeded.map(c => c.name)).size, seeded.length);
  check('id уникальны',
    new Set(seeded.map(c => c.id)).size, seeded.length);
  check('активный город существует',
    seeded.some(c => c.id === readActiveId()), true);

  // Главное свойство модели: настройки принадлежат городу, а не
  // приложению.  Если это сломается, поправки под мечеть в Назрани
  // молча уедут на Москву.
  const nazran = readCities()[0];
  const moscow = readCities().find(c => c.name === 'Москва');
  updateCitySettings(nazran.id, {
    ...nazran.settings, method: 'mwl',
    adjustments: { ...nazran.settings.adjustments, dhuhr: 5 },
  });
  const after = readCities();
  check('настройка применилась к своему городу',
    [after.find(c => c.id === nazran.id).settings.method,
     after.find(c => c.id === nazran.id).settings.adjustments.dhuhr], ['mwl', 5]);
  check('и не задела соседний',
    [after.find(c => c.id === moscow.id).settings.method,
     after.find(c => c.id === moscow.id).settings.adjustments.dhuhr], ['dumrf', 0]);

  // Порядок в списке — это порядок смахивания.
  const before = readCities().map(c => c.name);
  moveCity(readCities()[0].id, 1);
  const moved = readCities().map(c => c.name);
  check('перестановка меняет порядок', [moved[0], moved[1]], [before[1], before[0]]);
  moveCity(readCities()[1].id, -1);
  check('и возвращается обратно', readCities().map(c => c.name), before);

  // Повторное добавление того же места не плодит дубль.
  const n1 = readCities().length;
  addCity({ name: 'Назрань', lat: 43.2256, lon: 44.7642, source: 'manual' });
  check('дубль по координатам не добавляется', readCities().length, n1);

  addCity({ name: 'Стамбул', lat: 41.0082, lon: 28.9784, source: 'manual' });
  check('новый город добавляется', readCities().length, n1 + 1);
  check('и становится активным',
    readCities().find(c => c.id === readActiveId()).name, 'Стамбул');

  const target = readCities().find(c => c.name === 'Стамбул');
  removeCity(target.id);
  check('удаление работает',
    readCities().some(c => c.name === 'Стамбул'), false);
  check('активный город после удаления существует',
    readCities().some(c => c.id === readActiveId()), true);

  // Последний город не удаляем: экрану нужно что-то показывать.
  const only = readCities()[0];
  writeCities([only]);
  setActiveId(only.id);
  removeCity(only.id);
  check('последний город удалить нельзя', readCities().length, 1);

  // Испорченное хранилище не должно ронять экран.
  localStorage.setItem('prayer.cities', '{ не json');
  check('битое хранилище чинится', readCities().length >= 1, true);
  localStorage.setItem('prayer.cities', '[{"name":"Кривой"}]');
  check('запись без координат отбрасывается',
    readCities().every(c => Number.isFinite(c.lat) && Number.isFinite(c.lon)), true);

  check('потолок списка разумный', MAX_CITIES >= 4 && MAX_CITIES <= 20, true);
});

// ─── Скрытые дуа ──────────────────────────────────────────────────────
//
// Раздел дуа переделан 09.09.2026: «мой список» убран совсем, вместо него
// витрина со скрытием свайпом. Модель обратная прежней — раньше человек
// собирал подборку и видел пустой экран, теперь видит всё и убирает лишнее.
//
// 🔴 Скрытие в этом экране УЖЕ БЫЛО и его снимали: спрятанное дуа исчезало
// навсегда, вернуть было нечем. Поэтому главное свойство здесь — обратимость,
// и оно проверяется тестом, а не обещанием.
const скрытыеМод = await import(pathToFileURL(resolve(ROOT, 'src/lib/duaHidden.ts')).href);
const { readHiddenDua, hideDua, unhideDua, isDuaHidden } = скрытыеМод;

group('Скрытые дуа', () => {
  localStorage.removeItem('dua.hidden.v1');
  check('на старте не скрыто ничего', readHiddenDua(), []);

  hideDua('dua-002');
  check('скрытие запоминается', readHiddenDua(), ['dua-002']);
  check('принадлежность проверяется',
    [isDuaHidden('dua-002'), isDuaHidden('dua-001')], [true, false]);

  hideDua('dua-002');
  check('повторное скрытие не плодит дубль', readHiddenDua(), ['dua-002']);

  // Главное свойство: скрытое возвращается.
  unhideDua('dua-002');
  check('возврат работает', readHiddenDua(), []);
  unhideDua('dua-002');
  check('возврат несуществующего безвреден', readHiddenDua(), []);

  // Старый ключ НЕ читается: у того, кто прятал дуа до снятия фичи, они не
  // должны молча исчезнуть снова спустя месяц.
  localStorage.setItem('dua.hidden', '["dua-777"]');
  check('прежний ключ не подхватывается', readHiddenDua(), []);

  // Битое хранилище не роняет экран.
  localStorage.setItem('dua.hidden.v1', 'не json');
  check('битое хранилище даёт пустой список', readHiddenDua(), []);
  localStorage.setItem('dua.hidden.v1', '["a", 5, null, "b"]');
  check('мусор отбрасывается', readHiddenDua(), ['a', 'b']);
  localStorage.removeItem('dua.hidden.v1');
});

// ─── Стек экранов ─────────────────────────────────────────────────────
//
// Навигация — то место, где ошибка не падает, а тихо уводит человека не
// туда: «назад» с главного экрана проваливается обратно в суру, стек
// растёт без предела, жест и кнопка расходятся. Всё это ловится здесь.
const stackMod = await import(pathToFileURL(resolve(ROOT, 'src/lib/screenStack.ts')).href);
const { findQuranHome, stepsToQuranHome, reconcile, isRoot } = stackMod;

const HOME = { name: 'tabs', tab: 'quran' };
const AZKAR_TAB = { name: 'tabs', tab: 'azkar' };
const SURAH = { name: 'surah' };
const PLAYER = { name: 'player' };
const BOOKMARKS = { name: 'bookmarks' };

group('Стек экранов', () => {
  check('на корне снимать нечего', stepsToQuranHome([HOME]), 0);
  check('из суры — один шаг', stepsToQuranHome([HOME, SURAH]), 1);
  check('из плеера через суру — два шага',
    stepsToQuranHome([HOME, SURAH, PLAYER]), 2);
  check('из суры, открытой из закладок, — два шага',
    stepsToQuranHome([HOME, BOOKMARKS, SURAH]), 2);

  // Ближайшая снизу, а не первая попавшаяся: человек мог вернуться на
  // вкладку «Коран» из другой вкладки, и снимать надо до неё.
  check('берётся ближайшая вкладка «Коран», а не самая нижняя',
    stepsToQuranHome([HOME, AZKAR_TAB, HOME, SURAH]), 1);
  check('индекс ближайшей вкладки «Коран»',
    findQuranHome([HOME, AZKAR_TAB, HOME, SURAH]), 2);
  check('вкладки «Коран» нет — шагов ноль',
    stepsToQuranHome([AZKAR_TAB, SURAH]), 0);

  // Приведение к глубине. Тот же массив = менять нечего; на этом держится
  // идемпотентность обработчика popstate.
  const s3 = [HOME, SURAH, PLAYER];
  check('глубина совпадает — тот же массив', reconcile(s3, 2, HOME) === s3, true);
  check('возврат обрезает стек',
    reconcile(s3, 0, HOME).map(x => x.name), ['tabs']);
  check('возврат на шаг',
    reconcile(s3, 1, HOME).map(x => x.name), ['tabs', 'surah']);
  check('повторное приведение к той же глубине ничего не меняет',
    reconcile(reconcile(s3, 1, HOME), 1, HOME).map(x => x.name), ['tabs', 'surah']);
  check('глубина больше стека — сворачиваемся в корень',
    reconcile([HOME], 5, HOME).map(x => x.name), ['tabs']);

  // Корень определяется глубиной, а не флагом на первой записи: раньше
  // метка терялась после «вошёл в суру → вышел», и аппаратная «назад» с
  // главного экрана проваливалась обратно в суру.
  check('корень — глубина 0', [isRoot(0), isRoot(1), isRoot(undefined)],
    [true, false, false]);
});

// ─── Шрифты мусхафа: пара «шрифт + страница» ──────────────────────────
//
// Здесь проверяется то, от чего зависит, какое СЛОВО окажется в аяте.
// QCF V4 переиспользует одни и те же PUA-коды в разных шрифтах: код
// 0xF103 в Hafs_01 и в Hafs_06 — разные слова.  После нарезки шрифтов по
// страницам к этому добавилась страница: подмножества обязаны жить в
// разных семействах, иначе браузер сложит их в одно `font-family` и
// покажет глиф не той страницы — то есть чужое слово внутри аята.
//
// Ошибку такого рода не поймает ни типизация, ни сборка: на экране будет
// красивый арабский, просто не тот. Отсюда тесты.
const qcfMod = await import(pathToFileURL(resolve(ROOT, 'src/lib/qcf4.ts')).href);
const { qcfPageFamily, qcfPageFontUrl, distinctFontRefs, hydratePage } = qcfMod;

group('Шрифты мусхафа: семейство несёт страницу', () => {
  check('семейство = шрифт + страница',
    qcfPageFamily('QCF4_Hafs_06', 77), 'QCF4_Hafs_06_p77');
  check('один шрифт на разных страницах — разные семейства',
    qcfPageFamily('QCF4_Hafs_06', 77) === qcfPageFamily('QCF4_Hafs_06', 78), false);
  check('разные шрифты на одной странице — тоже разные',
    qcfPageFamily('QCF4_Hafs_01', 77) === qcfPageFamily('QCF4_Hafs_06', 77), false);

  check('путь дополняется нулями до трёх цифр',
    qcfPageFontUrl('QCF4_Hafs_01', 1), '/qcf4/fonts-page/001/QCF4_Hafs_01.woff2');
  check('трёхзначная страница остаётся как есть',
    qcfPageFontUrl('QCF4_Hafs_47', 604), '/qcf4/fonts-page/604/QCF4_Hafs_47.woff2');
  check('служебный шрифт заголовков лежит там же',
    qcfPageFontUrl('QCF4_QBSML', 77), '/qcf4/fonts-page/077/QCF4_QBSML.woff2');
});

group('Шрифты мусхафа: какие подмножества нужны словам', () => {
  const word = (font, page, char = 'X') => ({ font, page, char, code: 1, text: '', type: 'word' });

  check('пустой список слов — пустой список подмножеств',
    distinctFontRefs([]), []);

  check('одно слово — одна пара',
    distinctFontRefs([word('QCF4_Hafs_06', 77)]),
    [{ font: 'QCF4_Hafs_06', page: 77 }]);

  check('повторы схлопываются',
    distinctFontRefs([
      word('QCF4_Hafs_06', 77), word('QCF4_Hafs_06', 77), word('QCF4_Hafs_06', 77),
    ]),
    [{ font: 'QCF4_Hafs_06', page: 77 }]);

  // Аят на стыке страниц берёт слова с двух — это самый частый случай,
  // где одной пары «шрифт + аят» не хватило бы.
  check('аят на стыке страниц требует оба подмножества',
    distinctFontRefs([word('QCF4_Hafs_06', 77), word('QCF4_Hafs_06', 78)]),
    [{ font: 'QCF4_Hafs_06', page: 77 }, { font: 'QCF4_Hafs_06', page: 78 }]);

  // Страница с началом суры: основной текст, заголовок и басмала — три
  // разных шрифта.
  check('три шрифта одной страницы дают три пары',
    distinctFontRefs([
      word('QCF4_Hafs_06', 77), word('QCF4_QBSML', 77), word('QCF4_Hafs_01', 77),
    ]),
    [
      { font: 'QCF4_Hafs_06', page: 77 },
      { font: 'QCF4_QBSML', page: 77 },
      { font: 'QCF4_Hafs_01', page: 77 },
    ]);

  check('порядок сохраняется — первым идёт шрифт первого слова',
    distinctFontRefs([word('QCF4_QBSML', 5), word('QCF4_Hafs_01', 5)]).map(r => r.font),
    ['QCF4_QBSML', 'QCF4_Hafs_01']);

  // Слово без страницы просить нечего: семейства для него не существует.
  // Молча пропускаем, а не подставляем нулевую страницу — иначе получили
  // бы ссылку на несуществующий файл и вечный скелет.
  check('слово без страницы пропускается',
    distinctFontRefs([{ font: 'QCF4_Hafs_06', char: 'X', code: 1, text: '', type: 'word' }]), []);
  check('слово без шрифта пропускается',
    distinctFontRefs([{ font: '', page: 77, char: 'X', code: 1, text: '', type: 'word' }]), []);
});

group('Шрифты мусхафа: страница проставляется каждому слову', () => {
  const page = {
    page: 77,
    font: 'QCF4_Hafs_06',
    surahs: [],
    lines: [
      { line: 1, words: [
        { font: 'QCF4_QBSML', char: 'A', code: 1, text: '', type: 'surah_header' },
        { font: 'QCF4_Hafs_06', char: 'B', code: 2, text: '', type: 'word' },
      ] },
      { line: 2, words: [
        { font: 'QCF4_Hafs_06', char: 'C', code: 3, text: '', type: 'word' },
      ] },
    ],
  };
  const out = hydratePage(page);

  check('каждое слово знает свою страницу',
    out.lines.flatMap(l => l.words).map(w => w.page), [77, 77, 77]);
  check('возвращается тот же объект, без копии',
    out === page, true);
  check('после hydratePage подмножества считаются',
    distinctFontRefs(out.lines.flatMap(l => l.words)),
    [{ font: 'QCF4_QBSML', page: 77 }, { font: 'QCF4_Hafs_06', page: 77 }]);

  // Повторный вызов на той же странице ничего не портит: данные лежат в
  // общем кэше, и через него проходят оба загрузчика.
  hydratePage(out);
  check('повторный вызов идемпотентен',
    out.lines.flatMap(l => l.words).map(w => w.page), [77, 77, 77]);
});

// ─── Два издания мусхафа: V4 и V1 «Мадани 1405» ───────────────────────
//
// Издания делят и формат данных, и диапазон PUA-кодов, но означают этими
// кодами РАЗНЫЕ слова.  Поэтому любая путаница между ними выглядит как
// исправная страница мусхафа с чужим арабским: ни типы, ни сборка, ни
// беглый взгляд её не поймают.  Отсюда тесты на две вещи — как издание
// выбирает семейство шрифта и как оно разделяет кэш страниц.
const {
  editionOf, qcfFontFamily, qcfWordFamily, pageFontRefs, v1PageFontRefs,
  pageJsonPath, DEFAULT_QCF_EDITION,
} = qcfMod;
const arabicFontMod = await import(
  pathToFileURL(resolve(ROOT, 'src/hooks/useArabicPageFont.ts')).href
);
const { v1FontSlot, arabicPageFamily } = arabicFontMod;

/** Страница V1 в том виде, в каком её отдаёт /qcf1/pages/106.json. */
function v1Page() {
  return {
    page: 106,
    edition: 'qcf-v1',
    font: 'QCF1_P106',
    surahs: [{ id: 5, verse_start: 1, verse_end: 2 }],
    lines: [
      // Заголовок суры и басмала — единственные слова V1, у которых
      // шрифт назван явно.
      { line: 6, words: [
        { code: 64396, char: 'A', text: '', type: 'surah_header', font: 'QCF1_BSML', sura: 5 },
        { code: 64401, char: 'B', text: '', type: 'surah_header', font: 'QCF1_BSML', sura: 5 },
      ] },
      // У обычного слова поля font нет — это не пропуск в данных, а
      // экономия ~1.7 МБ на каждый нативный пакет.
      { line: 7, words: [
        { code: 64337, char: 'C', text: 'قُلِ', type: 'word', verse_key: '5:1', position: 1 },
      ] },
    ],
  };
}

/** Страница V4 того же номера — данные другие, номер тот же. */
function v4Page() {
  return {
    page: 106,
    font: 'QCF4_Hafs_08',
    surahs: [{ id: 5, name: "Al-Ma'idah", name_arabic: 'المائدة', verse_start: 1, verse_end: 2 }],
    lines: [
      { line: 6, words: [
        { code: 61700, char: 'A', text: '', type: 'surah_header', font: 'QCF4_QBSML', sura: 5 },
      ] },
      { line: 7, words: [
        { code: 63702, char: 'C', text: '', type: 'word', font: 'QCF4_Hafs_08', verse_key: '5:1', position: 1 },
      ] },
    ],
  };
}

group('Два издания: путь к данным страницы', () => {
  check('без указания издания путь ведёт в V4',
    pageJsonPath(106), '/qcf4/pages/106.json');
  check('издание V4 названо явно — тот же путь',
    pageJsonPath(106, 'qcf-v4'), '/qcf4/pages/106.json');
  check('издание V1 берёт данные из своего каталога',
    pageJsonPath(106, 'qcf-v1'), '/qcf1/pages/106.json');
  check('номер дополняется нулями в обоих изданиях',
    [pageJsonPath(7, 'qcf-v4'), pageJsonPath(7, 'qcf-v1')],
    ['/qcf4/pages/007.json', '/qcf1/pages/007.json']);
  check('умолчание издания — V4', DEFAULT_QCF_EDITION, 'qcf-v4');
  check('страница без поля edition считается страницей V4',
    editionOf({ page: 1 }), 'qcf-v4');
  check('поле edition читается как есть',
    editionOf({ page: 1, edition: 'qcf-v1' }), 'qcf-v1');
});

group('Два издания: семейство шрифта считается по изданию', () => {
  // V4: шрифт нарезан по страницам, поэтому семейство несёт номер.
  check('V4 добавляет номер страницы к имени шрифта',
    qcfFontFamily({ font: 'QCF4_Hafs_08', page: 106, edition: 'qcf-v4' }),
    'QCF4_Hafs_08_p106');
  check('ссылка без издания ведёт себя как V4',
    qcfFontFamily({ font: 'QCF4_Hafs_08', page: 106 }), 'QCF4_Hafs_08_p106');
  // V1: файл сам постраничный, суффикс сделал бы имя, под которым нет
  // ни одного @font-face, — страница осталась бы вечным скелетом.
  check('V1 берёт имя шрифта как есть, без суффикса',
    qcfFontFamily({ font: 'QCF1_P106', page: 106, edition: 'qcf-v1' }), 'QCF1_P106');
  check('служебный шрифт V1 тоже без суффикса',
    qcfFontFamily({ font: 'QCF1_BSML', page: 106, edition: 'qcf-v1' }), 'QCF1_BSML');
  check('одна и та же страница в двух изданиях — разные семейства',
    qcfFontFamily({ font: 'QCF1_P106', page: 106, edition: 'qcf-v1' })
      === qcfFontFamily({ font: 'QCF1_P106', page: 106, edition: 'qcf-v4' }),
    false);

  const v1 = v1Page();
  const v4 = v4Page();
  check('обычное слово V1 берёт шрифт страницы',
    qcfWordFamily(v1.lines[1].words[0], v1), 'QCF1_P106');
  check('заголовок суры V1 берёт свой шрифт',
    qcfWordFamily(v1.lines[0].words[0], v1), 'QCF1_BSML');
  check('слово V4 получает семейство с номером страницы',
    qcfWordFamily({ ...v4.lines[1].words[0], page: 106 }, v4), 'QCF4_Hafs_08_p106');
  check('слово V4 без проставленной страницы берёт номер у страницы',
    qcfWordFamily(v4.lines[1].words[0], v4), 'QCF4_Hafs_08_p106');
});

group('Два издания: какие шрифты заказывает страница', () => {
  const v1 = v1Page();
  check('V1 просит страничный шрифт и служебный BSML',
    v1PageFontRefs(v1),
    [
      { font: 'QCF1_P106', page: 106, edition: 'qcf-v1' },
      { font: 'QCF1_BSML', page: 106, edition: 'qcf-v1' },
    ]);
  check('pageFontRefs выбирает V1 по полю edition',
    pageFontRefs(v1), v1PageFontRefs(v1));

  // Страница V1 без заголовка суры: у всех слов шрифта нет, и единственный
  // источник — сама страница.  Пустой список означал бы вечный скелет.
  const plain = {
    page: 200, edition: 'qcf-v1', font: 'QCF1_P200', surahs: [],
    lines: [{ line: 1, words: [{ code: 1, char: 'A', text: '', type: 'word' }] }],
  };
  check('страница V1 без заголовка всё равно просит свой шрифт',
    v1PageFontRefs(plain), [{ font: 'QCF1_P200', page: 200, edition: 'qcf-v1' }]);

  const v4 = v4Page();
  hydratePage(v4);
  // Издание проставляется каждой ссылке: `distinctFontRefs` требует его
  // явно, чтобы слова V1 нельзя было случайно посчитать по правилам V4.
  check('V4 по-прежнему считает шрифты по словам, и каждая ссылка названа изданием',
    pageFontRefs(v4),
    [
      { font: 'QCF4_QBSML', page: 106, edition: 'qcf-v4' },
      { font: 'QCF4_Hafs_08', page: 106, edition: 'qcf-v4' },
    ]);
});

group('Два издания: имена файлов шрифтов V1', () => {
  check('страница V1 даёт своё семейство',
    arabicPageFamily('v1', 106), 'QCF1_P106');
  check('басмала V1 — общий на весь мусхаф шрифт',
    arabicPageFamily('v1', 'bsml'), 'QCF1_BSML');
  // v1FontSlot — обратная функция к имени семейства: по ней повтор после
  // сбоя сети восстанавливает @font-face, зная только имя.
  check('имя семейства разбирается обратно в номер страницы',
    v1FontSlot('QCF1_P106'), 106);
  check('первая и последняя страницы разбираются',
    [v1FontSlot('QCF1_P001'), v1FontSlot('QCF1_P604')], [1, 604]);
  check('имя басмалы разбирается в свой ключ',
    v1FontSlot('QCF1_BSML'), 'bsml');
  check('семейство V4 не принимается за V1',
    v1FontSlot('QCF4_Hafs_08_p106'), null);
  check('несуществующая страница отвергается',
    [v1FontSlot('QCF1_P000'), v1FontSlot('QCF1_P605')], [null, null]);
  check('разбор обратен сборке на всех 604 страницах',
    (() => {
      for (let page = 1; page <= 604; page++) {
        if (v1FontSlot(arabicPageFamily('v1', page)) !== page) return page;
      }
      return 'ok';
    })(), 'ok');
});

// Кэш страниц.  Самый опасный сценарий фичи: страница 106 есть в обоих
// изданиях, и кэш по одному номеру молча отдал бы данные V4 там, где
// просили V1.  На экране был бы красивый, но ЧУЖОЙ арабский.
await groupAsync('Два издания: кэш страниц их не смешивает', async () => {
  const pageHookMod = await import(
    pathToFileURL(resolve(ROOT, 'src/hooks/useQcfPage.ts')).href
  );
  const { ensurePage, getPageSync } = pageHookMod;

  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requested.push(url);
    if (url === '/qcf1/pages/300.json') {
      // Подложенный файл V4: издание в нём не названо вовсе.
      return { ok: true, json: async () => ({ ...v4Page(), page: 300 }) };
    }
    if (url === '/qcf4/pages/301.json') {
      // Обратный случай: файл назвал чужое издание явно.
      return { ok: true, json: async () => ({ ...v1Page(), page: 301 }) };
    }
    const data = url.startsWith('/qcf1/') ? v1Page() : v4Page();
    return { ok: true, json: async () => data };
  };

  try {
    const fromV4 = await ensurePage(106);
    const fromV1 = await ensurePage(106, 'qcf-v1');

    check('за каждым изданием ушёл свой запрос',
      requested, ['/qcf4/pages/106.json', '/qcf1/pages/106.json']);
    check('издание V4 отдало свой шрифт страницы',
      fromV4.font, 'QCF4_Hafs_08');
    check('издание V1 отдало свой шрифт страницы',
      fromV1.font, 'QCF1_P106');
    check('страницы разных изданий — разные объекты',
      fromV4 === fromV1, false);

    // hydratePage проставляет издание, потому что в файлах V4 его нет:
    // дальше по коду издание читается только из данных.
    check('странице V4 проставлено её издание', fromV4.edition, 'qcf-v4');
    check('издание из файла V1 сохранено', fromV1.edition, 'qcf-v1');

    check('синхронный кэш различает издания',
      [getPageSync(106).font, getPageSync(106, 'qcf-v1').font],
      ['QCF4_Hafs_08', 'QCF1_P106']);

    await ensurePage(106);
    await ensurePage(106, 'qcf-v1');
    check('повторный запрос идёт из кэша, а не в сеть', requested.length, 2);

    let mismatch = null;
    try {
      await ensurePage(300, 'qcf-v1');
    } catch (err) {
      mismatch = String(err.message);
    }
    check('файл, не назвавший себя V1, до кэша не доходит',
      mismatch, 'page 300: ожидалось издание qcf-v1, в файле издание не указано');
    check('чужой файл не осел в кэше', getPageSync(300, 'qcf-v1'), null);

    let reverse = null;
    try {
      await ensurePage(301);
    } catch (err) {
      reverse = String(err.message);
    }
    check('файл, назвавший чужое издание, тоже отвергается',
      reverse, 'page 301: ожидалось издание qcf-v4, в файле qcf-v1');
    check('и он в кэше не остался', getPageSync(301), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── Данные и шрифты V1: комплект на месте ────────────────────────────
//
// Та же дешёвая защита, что и для V4: страница просит шрифт по имени, и
// если файла нет, аят молча остаётся пустым.  Проверка идёт по данным —
// для каждой страницы смотрим, какие шрифты она реально просит.
group('Мусхаф V1: данные и шрифты сходятся', () => {
  // Страницы V1 в Quran Ing не раздаются приложению — лежат вне сборки.
  const pagesDir = resolve(ROOT, 'data/qcf1-pages');
  const fontsDir = resolve(ROOT, 'public/qcf1/fonts-woff2');

  if (!existsSync(pagesDir) || !existsSync(fontsDir)) {
    check('издание V1 в этом клоне не собрано — это не ошибка кода',
      'нет каталога qcf1', 'нет каталога qcf1');
    return;
  }

  const files = readdirSync(pagesDir).filter(f => /^\d{3}\.json$/.test(f)).sort();
  check('страниц ровно 604', files.length, 604);

  const badEdition = [];
  const badPageNumber = [];
  const missingFonts = new Set();
  const emptyPages = [];
  // Слово, чьё семейство не заказано, покажет кубик: скелет снимется, а
  // @font-face под это имя никто не вставит.  Проверяем замкнутость:
  // множество семейств слов ⊆ множество заказанных шрифтов.
  const unrequested = new Set();

  for (const file of files) {
    const num = Number(file.slice(0, 3));
    const data = JSON.parse(readFileSync(resolve(pagesDir, file), 'utf8'));
    // Издание обязано стоять в самих данных: экран выбирает шрифт по нему,
    // а не по имени файла или префиксу шрифта.
    if (data.edition !== 'qcf-v1') badEdition.push(file);
    if (data.page !== num) badPageNumber.push(file);
    if (!data.lines?.length) emptyPages.push(file);

    const requestedFamilies = new Set(v1PageFontRefs(data).map(qcfFontFamily));
    for (const line of data.lines) {
      for (const word of line.words) {
        const family = qcfWordFamily(word, data);
        if (!requestedFamilies.has(family)) unrequested.add(`${file}:${family}`);
      }
    }

    for (const ref of v1PageFontRefs(data)) {
      const slot = v1FontSlot(ref.font);
      if (slot === null) { missingFonts.add(ref.font); continue; }
      const name = slot === 'bsml' ? 'QCF_BSML' : `QCF_P${String(slot).padStart(3, '0')}`;
      const path = resolve(fontsDir, `${name}.woff2`);
      if (!existsSync(path) || statSync(path).size === 0) missingFonts.add(name);
    }
  }

  check('у каждой страницы проставлено издание qcf-v1', badEdition, []);
  check('номер внутри файла совпадает с именем файла', badPageNumber, []);
  check('пустых страниц нет', emptyPages, []);
  check('все запрошенные шрифты V1 лежат на месте',
    Array.from(missingFonts).sort(), []);
  check('каждое слово рисуется семейством, которое страница заказала',
    Array.from(unrequested).sort(), []);
});

// ─── Шрифты мусхафа: все ли файлы на месте ────────────────────────────
//
// Самая дешёвая защита от самой дорогой ошибки: данные страниц правятся
// или обновляются, а перегенерацию шрифтов забывают — и на проде аяты
// молча остаются пустыми, потому что запрошенного подмножества просто
// нет на сервере.  Ни типы, ни сборка этого не видят.
//
// Проверка идёт по данным, а не по счётчику файлов: для каждой страницы
// смотрим, какие шрифты она реально просит, и требуем ровно эти файлы.
// Заодно ловится обратное — осиротевшие подмножества после того, как
// страница перестала использовать шрифт.
//
// Если файлов нет вовсе, проверка не падает, а честно говорит, что
// пайплайн не запускали: свежий клон без прогона build-page-fonts.py —
// это не сломанный код.
group('Шрифты мусхафа: подмножества сгенерированы полностью', () => {
  const pagesDir = resolve(ROOT, 'public/qcf4/pages');
  const fontsDir = resolve(ROOT, 'public/qcf4/fonts-page');

  if (!existsSync(fontsDir)) {
    check('пайплайн шрифтов не запускали — запустите scripts/build-page-fonts.py',
      'нет каталога fonts-page', 'нет каталога fonts-page');
    return;
  }

  const pageFiles = readdirSync(pagesDir).filter(f => /^\d{3}\.json$/.test(f)).sort();
  const missing = [];
  const orphans = [];
  let expected = 0;

  for (const file of pageFiles) {
    const num = file.slice(0, 3);
    const data = JSON.parse(readFileSync(resolve(pagesDir, file), 'utf8'));
    const needed = new Set();
    for (const line of data.lines) {
      for (const word of line.words) if (word.font) needed.add(word.font);
    }
    expected += needed.size;

    const dir = resolve(fontsDir, num);
    const have = existsSync(dir)
      ? new Set(readdirSync(dir).filter(f => f.endsWith('.woff2')).map(f => f.slice(0, -6)))
      : new Set();

    for (const font of needed) if (!have.has(font)) missing.push(`${num}/${font}`);
    for (const font of have) if (!needed.has(font)) orphans.push(`${num}/${font}`);
  }

  check('страниц с данными — 604', pageFiles.length, 604);
  check('нет страниц без своего шрифта', missing.slice(0, 5), []);
  check('нет лишних подмножеств', orphans.slice(0, 5), []);

  // Пустой файл — тоже отсутствующий шрифт, только его не видно по списку.
  const empties = [];
  for (const num of readdirSync(fontsDir).sort()) {
    const dir = resolve(fontsDir, num);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.woff2') && statSync(resolve(dir, f)).size < 512) {
        empties.push(`${num}/${f}`);
      }
    }
  }
  check('нет пустых или обрезанных файлов', empties.slice(0, 5), []);
  check('число подмножеств совпадает с тем, что просят страницы',
    missing.length + orphans.length, 0);
  void expected;
});

group('Цветной мусхаф: 604 страницы совпадают с разметкой QCF', () => {
  const tajweedDir = resolve(ROOT, 'public/tajweed/pages');
  const qcfDir = resolve(ROOT, 'public/qcf4/pages');
  const files = existsSync(tajweedDir)
    ? readdirSync(tajweedDir).filter(f => /^\d{3}\.json$/.test(f)).sort()
    : [];
  const invalid = [];
  const missingLines = [];

  for (const file of files) {
    const page = Number(file.slice(0, 3));
    const colour = JSON.parse(readFileSync(resolve(tajweedDir, file), 'utf8'));
    const qcf = JSON.parse(readFileSync(resolve(qcfDir, file), 'utf8'));
    const qcfByLine = new Map(qcf.lines.map(line => [line.line, line]));

    if (colour.page !== page || !colour.lines.length) invalid.push(`${file}: page/lines`);
    for (const line of colour.lines) {
      const qcfLine = qcfByLine.get(line.line);
      if (!qcfLine) {
        invalid.push(`${file}: line ${line.line}`);
        continue;
      }
      const verseKeys = new Set(qcfLine.words.map(word => word.verse_key).filter(Boolean));
      for (const word of line.words) {
        if (!word.code || !/^\d+:\d+$/.test(word.verseKey)
          || !Number.isInteger(word.position) || word.position < 1
          || !verseKeys.has(word.verseKey)) {
          invalid.push(`${file}:${line.line}:${word.verseKey}:${word.position}`);
        }
      }
    }

    for (const line of qcf.lines) {
      const hasVerseText = line.words.some(word => word.verse_key);
      if (hasVerseText && !colour.lines.some(item => item.line === line.line)) {
        missingLines.push(`${file}:${line.line}`);
      }
    }
  }

  check('цветных страниц — 604', files.length, 604);
  check('все элементы относятся к той же строке и аяту QCF', invalid.slice(0, 5), []);
  check('покрыты все строки с текстом аятов', missingLines.slice(0, 5), []);
});

// ─── Ошибка и повтор цветного шрифта ─────────────────────────────────
await groupAsync('Цветной шрифт: ошибка видна и загрузку можно повторить', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const styles = [];
  let succeed = false;
  let requests = 0;

  const head = {
    appendChild(el) { styles.push(el); },
    querySelectorAll(selector) {
      const family = selector.match(/data-tajweed-font="([^"]+)"/)?.[1];
      return styles.filter(el => !el.removed && (!family || el.dataset.tajweedFont === family));
    },
  };
  globalThis.document = {
    head,
    documentElement: { getAttribute() { return 'dark'; } },
    getElementById(id) {
      return styles.find(el => !el.removed && el.id === id) ?? null;
    },
    createElement() {
      return {
        dataset: {},
        textContent: '',
        removed: false,
        remove() { this.removed = true; },
      };
    },
    fonts: {
      async load() {
        requests++;
        return succeed ? [{ status: 'loaded' }] : [];
      },
    },
  };
  globalThis.window = new EventTarget();

  try {
    const fontMod = await import(
      pathToFileURL(resolve(ROOT, 'src/hooks/useTajweedFont.ts')).href
    );
    const family = 'QPC4Tajweed-test';

    await fontMod.loadTajweedFont(77, family, '\ufc00');
    check('пустой список FontFace отмечается как ошибка',
      fontMod.getTajweedFontStatus(family), 'failed');

    succeed = true;
    await fontMod.retryFailedTajweedFonts();
    check('повтор после восстановления сети загружает шрифт',
      fontMod.getTajweedFontStatus(family), 'ready');
    check('повтор действительно отправляет второй запрос', requests, 2);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

// ─── Разбивка страниц зависит от издания ─────────────────────────────
//
// Издания «Мадани 1405» (V1) и 1441 (V4) расходятся: у 25 страниц разный
// первый аят. Взять таблицу не того издания — значит открыть страницу, на
// которой запрошенного аята нет. Ничего при этом не падает, поэтому без
// теста ошибка вернулась бы незамеченной.

await groupAsync('Мусхаф: разбивка страниц у изданий своя', async () => {
  const mod = await import(
    pathToFileURL(resolve(ROOT, 'src/lib/mushafPages.ts')).href
  );
  const { pageOfAyah, firstAyahOfPage, surahAyahOfPage, MUSHAF_PAGES } = mod;

  // Опорный расхождение: сура Ат-Тин. В издании 1405 она открывает
  // страницу 597, в издании 1441 на той же странице ещё идёт сура 94.
  check('95:1 в издании 1405 — страница 597',
    pageOfAyah(95, 1, 'qcf-v1'), 597);
  check('в издании 1441 страница 597 начинается не с 95:1',
    surahAyahOfPage(597, 'qcf-v4').surah !== 95, true);

  check('умолчание совпадает с изданием 1441',
    pageOfAyah(95, 1), pageOfAyah(95, 1, 'qcf-v4'));

  // Переход в обе стороны обязан сходиться на одной странице, иначе
  // «открыть в мусхафе» и «вернуться к ленте» уводят человека всё дальше.
  for (const edition of ['qcf-v1', 'qcf-v4']) {
    let mismatch = 0;
    let notRising = 0;
    let prev = 0;
    for (let page = 1; page <= MUSHAF_PAGES; page++) {
      const first = firstAyahOfPage(page, edition);
      if (first <= prev) notRising++;
      prev = first;
      const { surah, ayah } = surahAyahOfPage(page, edition);
      if (pageOfAyah(surah, ayah, edition) !== page) mismatch++;
    }
    check(`${edition}: первые аяты страниц строго возрастают`, notRising, 0);
    check(`${edition}: переход «страница → аят → страница» сходится`, mismatch, 0);
  }

  // Издания обязаны именно расходиться: если таблицы совпали, значит одну
  // из них подменили другой, и тест обязан это заметить.
  let differ = 0;
  for (let page = 1; page <= MUSHAF_PAGES; page++) {
    if (firstAyahOfPage(page, 'qcf-v1') !== firstAyahOfPage(page, 'qcf-v4')) differ++;
  }
  check('таблицы изданий расходятся ровно на 25 страницах', differ, 25);
});

// ─── Автозагрузка не спорит с человеком ──────────────────────────────
//
// Здесь была ошибка, которую владелец поймал на телефоне: он жал «Пауза», а
// следующее событие смены сети запускало загрузку заново. Кнопка выглядела
// неработающей, причём только у чтеца по умолчанию — у остальных
// автозагрузки нет. Тест закрывает именно это правило.

await groupAsync('Автозагрузка уважает паузу и отказ', async () => {
  const mod = await import(
    pathToFileURL(resolve(ROOT, 'src/lib/audioAutoDownload.ts')).href
  );
  const { shouldAutoStart } = mod;

  check('на чистом состоянии автозагрузка начинается',
    shouldAutoStart('idle', false), true);

  // Главное правило. `paused` — это не «пока не качается», а «человек
  // остановил». Если перепутать с `idle`, загрузка вернётся сама.
  check('после паузы сама не начинается',
    shouldAutoStart('paused', false), false);

  check('после отказа не начинается даже на чистом состоянии',
    shouldAutoStart('idle', true), false);
  check('во время загрузки второй раз не запускается',
    shouldAutoStart('running', false), false);
  check('после ошибки сама не перезапускается',
    shouldAutoStart('error', false), false);

  // Отказ сильнее любого состояния: раз человек сказал «нет», состояние
  // задания на это уже не влияет.
  for (const status of ['idle', 'running', 'paused', 'error']) {
    check(`отказ перевешивает состояние «${status}»`,
      shouldAutoStart(status, true), false);
  }
});

// ─── Фонотека собирается сплошными записями ──────────────────────────
//
// Владелец 06.09.2026: «переключения между аятами — прям паузы, сделайте,
// чтобы вообще не было». Пауза бралась не из записи: автозагрузка собирала
// поаятные файлы, и как только сура собиралась целиком, плеер переключался
// на поаятное чтение — со швом на каждой границе. Приложение портило себя
// само, тем сильнее, чем дольше стояло на Wi-Fi.

await groupAsync('Фонотека качается сурами, а не аятами', async () => {
  const mod = await import(
    pathToFileURL(resolve(ROOT, 'src/lib/audioDownloads.ts')).href
  );
  const { fullDownloadSurahOrder } = mod;

  const всё = fullDownloadSurahOrder(() => false);
  check('в задании 114 сур, а не 6236 аятов', всё.length, 114);
  check('первой приезжает Аль-Фатиха', всё[0], 1);
  check('следом джуз Амма', всё[1], 78);
  check('джуз Амма кончается 114-й', всё[37], 114);
  check('только потом обычный порядок', всё[38], 2);

  const частично = fullDownloadSurahOrder(с => с === 1 || с === 78);
  check('скачанные суры в задание не попадают', частично.length, 112);
  check('и не занимают первое место', частично[0], 79);
});

await groupAsync('Старую поаятную фонотеку не удваиваем', async () => {
  const mod = await import(
    pathToFileURL(resolve(ROOT, 'src/lib/audioAutoDownload.ts')).href
  );
  const { shouldBuildSurahLibrary } = mod;

  check('на чистом устройстве собираем', shouldBuildSurahLibrary(0, 0), true);
  check('начатое сплошными продолжаем', shouldBuildSurahLibrary(10, 0), true);
  check('собранное не трогаем', shouldBuildSurahLibrary(114, 0), false);

  // Главное: 1.4 ГБ поаятных уже лежит — второй такой же комплект рядом
  // человек не заказывал.
  check('поверх полной поаятной фонотеки не заводимся',
    shouldBuildSurahLibrary(0, 6236), false);
  check('поверх половины поаятной тоже не заводимся',
    shouldBuildSurahLibrary(0, 3118), false);
  // А несколько десятков файлов от обычного чтения — не повод отказывать.
  check('осевшие от чтения аяты не мешают', shouldBuildSurahLibrary(0, 40), true);
});

// ─── Порядок азкаров ─────────────────────────────────────────────────
//
// Владелец 07.09.2026 передал приложение Jawziyya Azkar как образец: «сделай,
// как у них». Их последовательность перенесена в src/content/azkarAppOrder.ts.
// Ошибка здесь не падает и не видна: список остаётся полным, просто идёт не
// так, как в образце, — а заметить это может только тот, кто знает порядок
// наизусть. Поэтому проверяем на реальных данных.

await groupAsync('Азкары идут в порядке образца', async () => {
  const [prefs, порядок] = await Promise.all([
    import(pathToFileURL(resolve(ROOT, 'src/lib/azkarPrefs.ts')).href),
    import(pathToFileURL(resolve(ROOT, 'src/content/azkarAppOrder.ts')).href),
  ]);
  const { orderAzkar } = prefs;
  const { AZKAR_APP_ORDER_MORNING, AZKAR_APP_ORDER_EVENING } = порядок;

  const { readFileSync } = await import('node:fs');
  const данные = JSON.parse(readFileSync(resolve(ROOT, 'public/azkar/azkar.json'), 'utf8'));

  for (const [кат, образец] of [
    ['morning', AZKAR_APP_ORDER_MORNING],
    ['evening', AZKAR_APP_ORDER_EVENING],
  ]) {
    const сп = данные.entries.filter(e => e.category === кат);
    const вышло = orderAzkar(сп, 'app').map(x => x.id);

    // Ожидаемое: сперва образец, затем всё, чего в образце нет, своим чередом.
    const хвост = сп.map(x => x.id).filter(id => !образец.includes(id));
    check(`«${кат}»: порядок совпадает с образцом`,
      вышло.join(','), [...образец, ...хвост].join(','));
    check(`«${кат}»: ни один азкар не потерян`, вышло.length, сп.length);
    check(`«${кат}»: без повторов`, new Set(вышло).size, сп.length);

    const поНомерам = orderAzkar(сп, 'book').map(x => x.id);
    check(`«${кат}»: второй вариант — по номерам`,
      поНомерам.join(','),
      [...сп].sort((a, b) => a.n_in_category - b.n_in_category).map(x => x.id).join(','));
    check(`«${кат}»: порядки действительно разные`, вышло.join(',') !== поНомерам.join(','), true);
  }

  // Опознавательные точки образца: утренние начинаются с сайид аль-истигфар,
  // а аят аль-Курси стоит последним — так это и выглядит в их приложении.
  const утро = данные.entries.filter(e => e.category === 'morning');
  const у = orderAzkar(утро, 'app').map(x => x.id);
  check('утренние начинаются с сайид аль-истигфар', у[0], 'azkar-007');
  check('аят аль-Курси — последний', у[у.length - 1], 'azkar-038');

  // Вечерняя Бакара 285-286 у них отсутствует и обязана уйти в конец, а не
  // пропасть: список полный при любом варианте.
  const вечер = данные.entries.filter(e => e.category === 'evening');
  const в = orderAzkar(вечер, 'app').map(x => x.id);
  check('Бакара 285-286 сохраняется и стоит в конце', в[в.length - 1], 'azkar-040');

  // Исходный массив не трогаем.
  check('исходный массив не изменён', данные.entries[0].id, 'azkar-001');
});

await groupAsync('Быстрая прокрутка: палец → номер', async () => {
  const mod = await import(
    pathToFileURL(resolve(ROOT, 'src/lib/fastScroll.ts')).href
  );
  const { scrubIndex, FAST_SCROLL } = mod;
  const дорожка = { top: 100, bottom: 700, count: 114 };

  // 🔴 Главное: в момент включения под пальцем та же позиция, на которой
  // держали. Счёт по всей высоте экрана прыгал бы к середине диапазона.
  check('без движения — та самая сура, на которой держали',
    scrubIndex({ ...дорожка, y: 400, y0: 400, n0: 36 }), 36);
  check('до низа дорожки — последняя сура, откуда бы ни начали',
    scrubIndex({ ...дорожка, y: 700, y0: 400, n0: 36 }), 114);
  check('до верха дорожки — первая сура',
    scrubIndex({ ...дорожка, y: 100, y0: 400, n0: 36 }), 1);
  // Вниз от точки удержания путь делится на оставшиеся позиции:
  // 36 + 150/300 × 78 = 75.
  check('половина пути вниз — половина оставшихся сур',
    scrubIndex({ ...дорожка, y: 550, y0: 400, n0: 36 }), 75);
  check('палец за пределами дорожки не выводит за край',
    scrubIndex({ ...дорожка, y: 5000, y0: 400, n0: 36 }), 114);
  check('и вверх тоже',
    scrubIndex({ ...дорожка, y: -300, y0: 400, n0: 36 }), 1);
  check('на последней суре вниз ехать некуда',
    scrubIndex({ ...дорожка, y: 690, y0: 600, n0: 114 }), 114);
  check('на первой — вверх',
    scrubIndex({ ...дорожка, y: 150, y0: 300, n0: 1 }), 1);
  check('одна позиция — всегда она',
    scrubIndex({ top: 100, bottom: 700, count: 1, y: 600, y0: 200, n0: 1 }), 1);

  // Монотонность: палец ниже — номер не меньше. Иначе номер в пузыре
  // дёргался бы туда-обратно при ровном движении.
  let сломано = 0, прежний = 0;
  for (let y = 100; y <= 700; y += 3) {
    const n = scrubIndex({ ...дорожка, y, y0: 260, n0: 20 });
    if (n < прежний) сломано++;
    прежний = n;
  }
  check('номер не убывает, пока палец идёт вниз', сломано, 0);

  // Выключатели — по одному на место: владелец просил убирать функцию в
  // одном месте, оставляя в другом.
  check('выключатель главной на месте', typeof FAST_SCROLL.surahList, 'boolean');
  check('выключатель ленты на месте', typeof FAST_SCROLL.ayahFeed, 'boolean');
});

await groupAsync('Возврат из поаятного режима на сплошную запись', async () => {
  const mod = await import(
    pathToFileURL(resolve(ROOT, 'src/lib/audioRecovery.ts')).href
  );
  const {
    recoveryDelayMs, RECOVERY_FIRST_DELAY_MS, RECOVERY_MAX_DELAY_MS,
  } = mod;

  // Числа выводятся из констант: поменяй константу — тест не станет врать.
  check('первая проверка — через первую паузу', recoveryDelayMs(1), RECOVERY_FIRST_DELAY_MS);
  check('каждая неудача удваивает паузу', recoveryDelayMs(3), RECOVERY_FIRST_DELAY_MS * 4);
  check('пауза не растёт выше предела', recoveryDelayMs(50), RECOVERY_MAX_DELAY_MS);
  check('предел достигается, а не пролетается', recoveryDelayMs(1e9), RECOVERY_MAX_DELAY_MS);

  // Мусор на входе не должен давать мгновенных проверок: нулевая пауза на
  // мёртвой сети — это секунды тишины посреди чтения каждые пару секунд.
  check('ноль — как первая попытка', recoveryDelayMs(0), RECOVERY_FIRST_DELAY_MS);
  check('отрицательное — как первая попытка', recoveryDelayMs(-4), RECOVERY_FIRST_DELAY_MS);
  check('NaN — как первая попытка', recoveryDelayMs(NaN), RECOVERY_FIRST_DELAY_MS);

  let убывает = 0;
  for (let n = 2; n < 40; n++) if (recoveryDelayMs(n) < recoveryDelayMs(n - 1)) убывает++;
  check('пауза не убывает с числом неудач', убывает, 0);
});

// ─── Итог ─────────────────────────────────────────────────────────────
console.log('');
if (failures.length === 0) {
  console.log(`✅ Все проверки пройдены (${passed})`);
  process.exit(0);
}
console.error(`❌ Провалено: ${failures.length}, пройдено: ${passed}\n`);
for (const f of failures) console.error('  ✗ ' + f);
process.exit(1);
