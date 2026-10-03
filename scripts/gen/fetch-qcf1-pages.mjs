/**
 * Генератор постраничной разметки мусхафа QCF V1 «Мадани» (издание 1405).
 *
 * ── Зачем ─────────────────────────────────────────────────────────────
 *
 * 605 шрифтов V1 (48 МБ) уже лежат в `public/qcf1/fonts-woff2` и едут в
 * каждом пакете iOS и Android, но в полноэкранном режиме были недоступны:
 * там есть только QCF V4 и цветной таджвид. Не хватало ровно одного —
 * разметки «какое слово на какой строке». Шрифты новых байтов не требуют.
 *
 * ── Откуда данные ─────────────────────────────────────────────────────
 *
 * Два источника, и это важно: они закрывают разные половины задачи.
 *
 *   1. СЛОВА АЯТОВ — `api.qurancdn.com/api/qdc/verses/by_page/{N}`, тот же
 *      источник, что у генератора цветного таджвида
 *      (`fetch-tajweed-data.ts`).
 *   2. ЗАГОЛОВКИ СУР И БАСМАЛА — `scripts/gen/data/qcf1-decor-lines.json`,
 *      извлечённые из дампа `quran/quran.com-images` (см. ниже). API их не
 *      отдаёт вообще, ни при каком значении `mushaf`.
 *
 * ── 🔴 Ловушка, стоившая бы молчаливой ошибки ─────────────────────────
 *
 * Параметр `mushaf` НЕ интуитивен: **`mushaf=1` — это QCF V2, а
 * `mushaf=2` — QCF V1.** Проверено дважды и независимо:
 *
 *   1. Перечисление в исходниках quran.com
 *      (`quran/quran.com-frontend-next`, `types/QuranReader.ts`):
 *      `QCFV2 = 1, QCFV1 = 2`, и рядом `MadaniV1 → QCFV1`.
 *   2. Экспериментом: на странице 3 разбиение по строкам у `mushaf=1` и
 *      `mushaf=2` расходится (строки 8–10: 11/9/9 против 9/10/10).
 *
 * При этом САМИ КОДЫ глифов (`code_v1`) одинаковы при обоих значениях —
 * сверено с проверенными `v1Codes` из `public/arabic-editions.json`,
 * совпало 11 из 11 аятов страницы 3. То есть ошибка в `mushaf` не дала бы
 * ни пустых глифов, ни сбоя загрузки: страница отрисовалась бы красиво и
 * молча с ЧУЖИМ разбиением по строкам. Ровно тот класс ошибок, о котором
 * предупреждает `MUSHAF_FONTS.md`.
 *
 * ── Откуда взялись заголовки сур и басмала ────────────────────────────
 *
 * История вопроса длинная, и её стоит знать, чтобы не пойти по кругу.
 *
 * API не отдаёт двух строк на страницах с началом суры — заголовка и
 * басмалы. Проверено на странице 106 (кончается сура 4, начинается сура 5):
 * приходят строки 1–5 и 8–15, шестая и седьмая пусты. То же самое у
 * `mushaf=1` (V2), так что переход на V2 задачу не решал.
 *
 * Первая гипотеза была «в `QCF_BSML.woff2` лежит по глифу на название
 * суры, надо найти таблицу соответствия». Гипотеза оказалась неверной, а
 * проверка — поучительной:
 *
 *   • Обычные арабские коды U+06xx в этом шрифте ведут на ПУСТУЮ
 *     прямоугольную заглушку: у `seenarabic` и `alefarabic` один и тот же
 *     контур из восьми точек, то есть «кубик». Проверка «есть ли символ в
 *     cmap» здесь врёт — cmap отвечает «есть», а на экране кубик. Сверять
 *     надо контур глифа, а не наличие кода в таблице.
 *   • Настоящие глифы (394 из 574) лежат на латинских кодах и в
 *     Presentation Forms-A. Это словные куски: басмала, таʿаввуз,
 *     «قَالَ تَعَالَىٰ», «صدق الله العظيم», розетки и разделители.
 *
 * Источник, который закрыл вопрос, — **`github.com/quran/quran.com-images`**,
 * оригинальный генератор постраничных картинок V1. Там лежит и тот же самый
 * шрифт (`res/fonts/QCF_BSML.TTF`), и дамп разметки (`sql/02-database.sql`
 * плюс патч `sql/03-basmallah-shaddah.sql`): таблицы `glyph` и
 * `glyph_page_line` с типом строки `sura` / `ayah` / `bismillah`.
 *
 * Что дала сверка этого дампа (прогонялась вживую, а не принималась на
 * веру):
 *
 *   • 604 страницы, нумерация строк сплошная. По 15 строк везде, кроме
 *     первых двух — там по 8.
 *   • 114 строк заголовков и ровно 112 строк басмалы. Разница в две штуки
 *     осмысленна: у Аль-Фатихи басмала — это аят, у Ат-Тауба её нет.
 *   • Все 125 использованных кодов присутствуют в нашем
 *     `public/qcf1/fonts-woff2/QCF_BSML.woff2` и прорисованы (не «кубики»).
 *   • Отрисовка глазами: «سُورَةُ الفَاتِحَةِ», «سُورَةُ المَائِدَةِ»,
 *     «سُورَةُ التِّينِ», «سُورَةُ النَّاسِ» и все три варианта басмалы
 *     читаются верно. Заголовок суры 5 совпал с тем, что лежит в данных V4.
 *   • Сверка с живым API на 12 страницах (1, 2, 50, 106, 187, 208, 221,
 *     255, 300, 597, 598, 604): множество строк-аятов из дампа в точности
 *     совпало с тем, что отдаёт API. Расхождений 0.
 *
 * 🔴 Две вещи, на которых легко ошибиться:
 *
 *   1. **Коды заголовков нельзя вычислять формулой.** `0xFB8C + N` даёт
 *      верный код только для 37 сур из 114: на суре 38 в шрифте разрыв
 *      (U+FBB1 → U+FBD3). Поэтому в репозитории лежит таблица, а не
 *      арифметика.
 *   2. **Пробел в нумерации НЕ говорит, что рисовать.** У страницы 187
 *      (сура 9, басмалы нет) и у страницы 208 пропущена ровно одна строка,
 *      но на 187-й это заголовок, а на 208-й — басмала, потому что
 *      заголовок суры 10 остался на предыдущей странице. Достраивать
 *      разметку «по дыркам» — значит молча получить неверную страницу.
 *
 * ── Нумерация строк на первых страницах ───────────────────────────────
 *
 * У страниц 1 и 2 API нумерует строки не с единицы: там сверху пустое поле
 * под рамку. Смещение ровно +7 и одинаковое для обеих страниц — это
 * следует из дампа и подтверждено сверкой (API-строка 9 на первой странице
 * это строка 2 мусхафа, потому что первая занята заголовком).
 *
 * Прежняя версия нормализовала строки по минимальному номеру на странице.
 * Так делать нельзя: на первой странице минимум равен девяти, и вычитание
 * дало бы строку 1, которая на самом деле занята заголовком суры. Строки
 * наехали бы друг на друга молча.
 *
 * ── Запуск ────────────────────────────────────────────────────────────
 *
 *   node scripts/gen/fetch-qcf1-pages.mjs           # все 604 страницы
 *   node scripts/gen/fetch-qcf1-pages.mjs 1 10      # диапазон, для проверки
 *
 * Результат — `data/qcf1-pages/NNN.json`.  В Quran Ing это вне сборки:
 * лента рисует V1 из arabic-editions.json, а страницы нужны только для
 * сверок (индекс страниц, тест «Мусхаф V1: данные и шрифты сходятся»).
 * Скрипт идемпотентен: повторный запуск перезаписывает файлы теми же
 * данными.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = resolve(ROOT, 'data/qcf1-pages');
const DECOR_PATH = resolve(ROOT, 'scripts/gen/data/qcf1-decor-lines.json');
const API_BASE = 'https://api.qurancdn.com/api/qdc/verses/by_page/';
const TOTAL_PAGES = 604;

/** Строки заголовков и басмалы: страница → массив строк. См. шапку файла. */
const DECOR = JSON.parse(readFileSync(DECOR_PATH, 'utf8'));

/**
 * Семейство постраничного шрифта V1.
 *
 * Имя обязано нести номер страницы (правило №2 из `MUSHAF_FONTS.md`): одни и
 * те же PUA-коды в разных шрифтах означают разные слова, и общее имя дало бы
 * на экране красивый арабский, но чужой.
 *
 * Префикс `QCF1_` — соглашение `src/hooks/useArabicPageFont.ts`, которое
 * отделяет эти семейства от постраничных подмножеств V4 (`QCF4_Hafs_NN`).
 */
const fontFamily = page => `QCF1_P${String(page).padStart(3, '0')}`;

/** Общий на весь мусхаф шрифт заголовков и басмалы. Не постраничный. */
const BSML_FAMILY = 'QCF1_BSML';

/**
 * Смещение нумерации строк в ответе API.
 *
 * Ноль везде, кроме первых двух страниц: там мусхаф прижимает текст к низу
 * пятнадцатистрочной сетки, а API отдаёт «сырые» номера сетки.
 */
const lineOffset = page => (page <= 2 ? 7 : 0);

/** Сколько строк на странице по данным мусхафа. Первые две короче. */
const lineCount = page => (page <= 2 ? 8 : 15);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(page, attempt = 1) {
  const fields = 'code_v1,text_uthmani,position,page_number,line_number,verse_key,char_type_name';
  // mushaf=2 — именно QCF V1. См. предупреждение в шапке файла.
  const url = `${API_BASE}${page}?words=true&word_fields=${fields}&per_page=all&mushaf=2`;
  try {
    const res = await fetch(url, {
      // Без User-Agent публичный API отвечает 403.
      headers: { 'User-Agent': 'QuranRu-mushaf-generator', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body.verses)) throw new Error('нет поля verses');
    return body.verses;
  } catch (error) {
    if (attempt >= 4) throw new Error(`страница ${page}: ${error.message}`);
    // Растущая пауза: у публичного API бывает ограничение частоты, и
    // упереться в него на 604 запросах легко.
    await sleep(400 * attempt);
    return fetchPage(page, attempt + 1);
  }
}

function buildPage(page, verses) {
  const byLine = new Map();
  const surahs = new Map();
  const offset = lineOffset(page);

  for (const verse of verses) {
    const [surahId, ayahText] = verse.verse_key.split(':');
    const id = Number(surahId);
    const ayah = Number(ayahText);
    const known = surahs.get(id);
    if (!known) {
      surahs.set(id, { id, verse_start: ayah, verse_end: ayah });
    } else {
      known.verse_start = Math.min(known.verse_start, ayah);
      known.verse_end = Math.max(known.verse_end, ayah);
    }

    for (const word of verse.words ?? []) {
      // Слова соседних страниц в ответе встречаются: API отдаёт аят
      // целиком, даже если он пересекает границу страницы.
      if (word.page_number !== page) continue;
      if (!Number.isFinite(word.line_number)) continue;
      if (!word.code_v1) continue;

      const line = word.line_number - offset;
      if (!byLine.has(line)) byLine.set(line, []);
      byLine.get(line).push({
        code: word.code_v1.codePointAt(0),
        char: word.code_v1,
        text: word.text_uthmani ?? '',
        // `font` у обычных слов НЕ пишем: у V1 шрифт уже постраничный, и
        // страничного поля достаточно. Своё семейство несут только
        // заголовки и басмала — они набраны общим шрифтом. Экономия —
        // около 1,7 МБ в каждом из двух нативных пакетов.
        type: word.char_type_name === 'end' ? 'end' : 'word',
        verse_key: word.verse_key,
        position: word.position,
      });
    }
  }

  // Заголовки сур и басмала. Их шрифт — общий для всего мусхафа, а не
  // постраничный, поэтому имя семейства задаётся на самом слове: рендер
  // не должен догадываться об исключении.
  for (const item of DECOR[String(page)] ?? []) {
    if (byLine.has(item.line)) {
      throw new Error(
        `страница ${page}: строка ${item.line} занята словами аята, `
        + `но по разметке это ${item.type}`,
      );
    }
    byLine.set(item.line, item.codes.map((code, index) => ({
      code,
      char: String.fromCodePoint(code),
      text: '',
      type: item.type,
      font: BSML_FAMILY,
      sura: item.sura ?? null,
      position: index + 1,
    })));
  }

  const expected = lineCount(page);
  const lines = [];
  for (let line = 1; line <= expected; line++) {
    const words = byLine.get(line);
    if (!words) {
      // Дыра в странице мусхафа — это потерянная строка Корана. Молча
      // отдать такую страницу нельзя ни при каких обстоятельствах.
      throw new Error(`страница ${page}: строка ${line} пуста (ожидалось ${expected} строк)`);
    }
    lines.push({ line, words });
  }
  const extra = [...byLine.keys()].filter(line => line < 1 || line > expected);
  if (extra.length > 0) {
    throw new Error(`страница ${page}: строки вне диапазона 1..${expected}: ${extra.join(', ')}`);
  }

  return {
    page,
    // Издание записано в самих данных, а не выводится из имени шрифта:
    // рендеру нужно знать, как собирать семейство и откуда брать файл, и
    // догадываться об этом по префиксу — значит прятать правило в строке.
    edition: 'qcf-v1',
    font: fontFamily(page),
    surahs: [...surahs.values()].sort((a, b) => a.id - b.id),
    lines,
  };
}

async function main() {
  const from = Number(process.argv[2] ?? 1);
  const to = Number(process.argv[3] ?? TOTAL_PAGES);
  mkdirSync(OUT_DIR, { recursive: true });

  let bytes = 0;
  for (let page = from; page <= to; page++) {
    const verses = await fetchPage(page);
    const data = buildPage(page, verses);

    const json = JSON.stringify(data);
    bytes += json.length;
    writeFileSync(resolve(OUT_DIR, `${String(page).padStart(3, '0')}.json`), json);
    if (page % 25 === 0 || page === to) {
      console.log(`  ${page}/${to}  (${(bytes / 1048576).toFixed(1)} МБ)`);
    }
    // Пауза между запросами: 604 обращения подряд к публичному API без неё
    // выглядят как атака и получают ограничение частоты.
    await sleep(120);
  }
  console.log(`Готово: страницы ${from}–${to}, ${(bytes / 1048576).toFixed(1)} МБ`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
