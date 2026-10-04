/**
 * QCF V4 (King Fahd Complex, Madinah Mushaf 1441 AH) type definitions and
 * data-loading utilities.
 *
 * Assets live in /public/qcf4/:
 *   pages/NNN.json  — per-page glyph data (604 files)
 *   fonts-page/NNN/ — постраничные подмножества шрифтов (797 файлов,
 *                     ~71 КБ на страницу).  Нарезаются из 48 исходных
 *                     шрифтов скриптом scripts/build-page-fonts.py;
 *                     исходники лежат в vendor/qcf4-fonts-woff2/, вне
 *                     public — в рантайме они не нужны, а в пакете это
 *                     были лишние 36 МБ.
 *   verses.json     — verse_key → {page, lines}
 *   font-map.json   — page number → font name
 *
 * Each word has a single PUA character (U+F100…) that maps to a pre-composed
 * glyph in the corresponding QCF font.  Lines are explicit in the data — no
 * text-wrapping logic needed.
 *
 * ── Второе издание: QCF V1 «Мадани 1405» ──────────────────────────────
 *
 * Тот же формат страницы лежит и в /public/qcf1/pages/NNN.json, но глифы
 * там из другого мусхафа, а шрифты устроены иначе: файл `QCF_P106.woff2`
 * САМ является страницей 106, поэтому семейство равно имени шрифта и
 * суффикс страницы ему не нужен.  Из-за этого у обычных слов V1 поля
 * `font` намеренно нет — оно повторяло бы `pageData.font` у каждого из
 * ~150 слов страницы и стоило бы около 1.7 МБ в каждом нативном пакете.
 * Поле стоит только у заголовка суры и басмалы: они набраны общим на весь
 * мусхаф шрифтом `QCF1_BSML`.
 *
 * Отсюда правило: издание берётся из ЯВНОГО поля `edition`, а не из
 * префикса имени шрифта.  Данные и шрифты двух изданий используют
 * одни и те же PUA-коды, но означают ими разные слова, поэтому ошибка
 * в выборе издания не видна ни типам, ни сборке — на экране будет
 * красивый, но чужой арабский.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Издание мусхафа.  Отсутствие поля означает V4 — так лежат данные,
 * написанные до появления второго издания.
 */
export type QcfEdition = 'qcf-v4' | 'qcf-v1';

export const DEFAULT_QCF_EDITION: QcfEdition = 'qcf-v4';

/** Издание страницы с учётом умолчания для старых данных. */
export function editionOf(data: Pick<QcfPageData, 'edition'>): QcfEdition {
  return data.edition ?? DEFAULT_QCF_EDITION;
}


export type QcfWordType = 'word' | 'end' | 'surah_header' | 'bismillah' | 'sajda' | 'quarter' | string;

export interface QcfWord {
  code: number;
  /** Single PUA character — must be rendered with the matching QCF font */
  char: string;
  /**
   * Имя шрифта слова: например "QCF4_Hafs_01" или "QCF4_QBSML".
   *
   * В данных V1 поле стоит только у заголовка суры и басмалы (`QCF1_BSML`).
   * У обычных слов его нет намеренно — они набраны страничным шрифтом из
   * `pageData.font`, и повторять его у каждого слова значило бы возить
   * лишние ~1.7 МБ в каждом нативном пакете.
   */
  font?: string;
  /** Unicode text equivalent — for search / accessibility, NOT for display */
  text: string;
  type: QcfWordType;
  /** "surah:ayah" — absent on headers */
  verse_key?: string;
  /** 1-based position within the ayah */
  position?: number;
  /** Surah number — present on headers */
  sura?: number;
  /**
   * Страница мусхафа, с которой пришло слово.  В JSON этого поля нет —
   * его проставляет `hydratePage` при загрузке.
   *
   * Нужно потому, что шрифты нарезаны по страницам, и семейство слова
   * зависит от страницы, а не только от `font`.  У аята на стыке страниц
   * слова приходят с двух страниц сразу, поэтому одного номера на аят
   * недостаточно — нужен номер на каждое слово.
   */
  page?: number;
}

export interface QcfLine {
  line: number;
  words: QcfWord[];
}

export interface QcfSurahMeta {
  id: number;
  /** Латинское имя суры.  В данных V1 его нет — название берётся из
   *  справочника по номеру, а не из страницы мусхафа. */
  name?: string;
  name_arabic?: string;
  verse_start: number;
  verse_end: number;
}

export interface QcfPageData {
  page: number;
  /**
   * Издание, из которого пришла страница.  В файлах V4 поля нет, поэтому
   * его проставляет `hydratePage` при загрузке — дальше по коду издание
   * читается только отсюда и никогда не угадывается по имени шрифта.
   */
  edition?: QcfEdition;
  /** Primary font for this page (most words use it) */
  font: string;
  surahs: QcfSurahMeta[];
  lines: QcfLine[];
}

export interface VerseLocation {
  page: number;
  lines: Array<{ line: number; word_start: number; word_end: number }>;
}

export type VersesJson = Record<string, VerseLocation>;

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Семейство для CSS: шрифт плюс страница.
 *
 * Подмножества одного шрифта для разных страниц обязаны жить в разных
 * семействах.  Если назвать их одинаково, браузер сложит все `@font-face`
 * с этим именем в одно семейство и на пересекающихся PUA-кодах отдаст
 * глиф не той страницы — то есть чужое слово внутри аята.
 */
export function qcfPageFamily(fontName: string, page: number): string {
  return `${fontName}_p${page}`;
}

/** Постраничное подмножество: /qcf4/fonts-page/077/QCF4_Hafs_06.woff2 */
export function qcfPageFontUrl(fontName: string, page: number): string {
  return `/qcf4/fonts-page/${String(page).padStart(3, '0')}/${fontName}.woff2`;
}

/**
 * Пара «шрифт + страница» — минимум, которым однозначно задаётся семейство.
 *
 * `edition` дописан третьим полем, а не подмешан в имя шрифта: у V1
 * семейство равно имени шрифта, и отличить его от V4 по строке нельзя
 * иначе как разбором префикса — а разбор префикса это ровно тот способ
 * «догадаться об издании», который здесь запрещён.  Отсутствие поля
 * означает V4: так лежат все ссылки, написанные до второго издания.
 */
export interface QcfFontRef {
  font: string;
  page: number;
  edition?: QcfEdition;
}

/**
 * Имя CSS-семейства для ссылки на шрифт.
 *
 * V4: подмножество нарезано по страницам, поэтому к имени шрифта
 * добавляется номер страницы (см. qcfPageFamily).
 * V1: файл сам по себе постраничный, семейство равно имени шрифта, и
 * добавлять суффикс нельзя — под таким именем не окажется ни одного
 * `@font-face`, и страница осталась бы вечным скелетом.
 */
export function qcfFontFamily(ref: QcfFontRef): string {
  return (ref.edition ?? DEFAULT_QCF_EDITION) === 'qcf-v1'
    ? ref.font
    : qcfPageFamily(ref.font, ref.page);
}

/**
 * Какие подмножества нужны набору слов, без повторов.
 *
 * Слова аята могут лежать на двух страницах, а на одной странице
 * встречаться слова из трёх разных шрифтов — поэтому считаем по парам.
 *
 * 🔴 Издание — обязательный параметр, и умолчания у него намеренно нет.
 * Функция собирает имена CSS-семейств, а они у изданий строятся
 * по-разному. Подставь сюда слова V1 без издания — получишь семейство
 * `QCF1_BSML_p106`, под которым нет ни одного `@font-face`: страница
 * останется вечным скелетом с плашкой ошибки. Умолчание превратило бы
 * это в ошибку, которую легко не заметить при чтении кода.
 */
export function distinctFontRefs(words: QcfWord[], edition: QcfEdition): QcfFontRef[] {
  const seen = new Set<string>();
  const refs: QcfFontRef[] = [];
  for (const w of words) {
    if (!w.font || w.page == null) continue;
    const key = `${w.font}|${w.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ font: w.font, page: w.page, edition });
  }
  return refs;
}

/**
 * Какие шрифты нужны странице V1.
 *
 * У обычных слов V1 поля `font` нет — за них отвечает страничный шрифт
 * `data.font`, поэтому он попадает в список всегда, даже если ни одно
 * слово его не назвало.  Дальше добавляются шрифты, названные явно:
 * на практике это `QCF1_BSML` у заголовка суры и басмалы.  Страница у
 * всех ссылок одна — своя: файлы V1 постраничные сами по себе.
 */
export function v1PageFontRefs(data: QcfPageData): QcfFontRef[] {
  const refs: QcfFontRef[] = [
    { font: data.font, page: data.page, edition: 'qcf-v1' },
  ];
  const seen = new Set<string>([data.font]);
  for (const line of data.lines) {
    for (const word of line.words) {
      if (!word.font || seen.has(word.font)) continue;
      seen.add(word.font);
      refs.push({ font: word.font, page: data.page, edition: 'qcf-v1' });
    }
  }
  return refs;
}

/**
 * Какие шрифты нужны странице — независимо от издания.
 *
 * Единая точка входа для экрана: он не должен помнить, у какого издания
 * шрифт написан на слове, а у какого на странице.
 */
export function pageFontRefs(data: QcfPageData): QcfFontRef[] {
  return editionOf(data) === 'qcf-v1'
    ? v1PageFontRefs(data)
    : distinctFontRefs(data.lines.flatMap(line => line.words), 'qcf-v4');
}

/**
 * Каким семейством рисовать конкретное слово страницы.
 *
 * Издание берётся у страницы, а не у слова: у V1 обычное слово вообще
 * ничего о шрифте не знает, и единственный правдивый источник — страница.
 */
export function qcfWordFamily(word: QcfWord, data: QcfPageData): string {
  if (editionOf(data) === 'qcf-v1') return word.font || data.font;
  return qcfPageFamily(word.font ?? '', word.page ?? data.page);
}

/**
 * Проставить слову номер страницы.
 *
 * Данные страниц отдаются как есть, без номера внутри слова, а шрифт
 * теперь выбирается по паре (шрифт, страница) — значит номер нужен на
 * каждом слове.  Делается один раз при загрузке: слова живут в кэше и
 * расходятся по компонентам уже готовыми.
 */
export function hydratePage(
  data: QcfPageData,
  edition: QcfEdition = DEFAULT_QCF_EDITION,
): QcfPageData {
  // Издание проставляется здесь, потому что в файлах V4 его нет, а
  // дальше по коду оно читается из данных как из единственного
  // источника.  Если файл уже назвал издание сам (так делают файлы V1) —
  // верим файлу: он ближе к содержимому, чем аргумент загрузчика.
  data.edition = data.edition ?? edition;
  for (const line of data.lines) {
    for (const word of line.words) {
      word.page = data.page;
    }
  }
  return data;
}

/**
 * Zero-pads a page number to 3 digits for the filename.
 * e.g. 1 → "001", 42 → "042", 604 → "604"
 *
 * 🔴 Quran Ing: страницы V1 (`qcf-v1`) приложению НЕ раздаются — они
 * лежат в data/qcf1-pages только для сверок, а лента рисует V1 из
 * arabic-editions.json.  Путь для V1 сохранён ради тестов загрузчика;
 * чтобы снова грузить страницы V1 в приложении, их нужно вернуть в
 * public/qcf1/pages.
 */
export function pageJsonPath(
  pageNum: number,
  edition: QcfEdition = DEFAULT_QCF_EDITION,
): string {
  const padded = String(pageNum).padStart(3, '0');
  return edition === 'qcf-v1'
    ? `/qcf1/pages/${padded}.json`
    : `/qcf4/pages/${padded}.json`;
}

// ─── Singleton verse-map loader ───────────────────────────────────────────────

let versesCache: VersesJson | null = null;
let versesPromise: Promise<VersesJson> | null = null;

/**
 * Load (and permanently cache) /qcf4/verses.json.
 * Safe to call concurrently — only one network request is ever made.
 */
export function loadVersesJson(): Promise<VersesJson> {
  if (versesCache) return Promise.resolve(versesCache);
  if (versesPromise) return versesPromise;
  versesPromise = fetch('/qcf4/verses.json')
    .then(r => {
      if (!r.ok) throw new Error(`verses.json HTTP ${r.status}`);
      return r.json() as Promise<VersesJson>;
    })
    .then(data => {
      versesCache = data;
      return data;
    })
    .catch(err => {
      // Сбой не запоминаем: иначе одна неудача (фоновый прогрев при плохой
      // сети) ломала бы открытие любой суры до перезапуска приложения.
      versesPromise = null;
      throw err;
    });
  return versesPromise;
}

/**
 * Return the cached verse map synchronously, or null if not loaded yet.
 * Callers that already triggered loadVersesJson() can use this as a fast-path.
 */
export function getVersesJsonSync(): VersesJson | null {
  return versesCache;
}
