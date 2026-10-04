/**
 * Поиск по Корану: по названиям сур и по тексту переводов — ингушского
 * («ГӀалгӀай — Сийдолча КъорӀан маӀана таржам», 2023) и русского (Кулиев).
 *
 * ── Почему без индекса ────────────────────────────────────────────────
 *
 * Соблазн — построить инвертированный индекс слов при старте.  Но это
 * ~6236 аятов, около 900 тысяч символов: линейный проход с
 * `indexOf` укладывается в единицы миллисекунд даже на телефоне, а
 * индекс стоил бы времени на старте, памяти и кода, который надо
 * поддерживать.  Меряем, а не угадываем: если поиск начнёт тормозить
 * на реальном устройстве — тогда и появится причина для индекса.
 *
 * Что важнее скорости — качество совпадений:
 *
 *  • Регистр не важен.
 *  • «Ё» и «е» считаются одной буквой.  Кулиев пишет «Её», человек
 *    ищет «ее» — без этого половина запросов молча ничего не находит.
 *  • Знаки препинания в запросе игнорируются, несколько пробелов
 *    схлопываются: «Господу миров» найдётся и как «господу,  миров».
 *  • Ингушская палочка набирается как угодно: «I», «Ӏ» или «1» рядом с
 *    кириллицей — всё одна буква.  В источнике стоит латинская «I».
 *  • Знаки ударения не мешают: «Алла́хӀа» найдётся как «аллахIа».  В
 *    источнике ударные гласные иногда набраны латиницей посреди
 *    кириллического слова («тóхар») — для сравнения они приводятся к
 *    кириллице.
 *
 * Всё это — только правила СРАВНЕНИЯ.  На экран идёт исходный текст,
 * подсветка вырезается из него по карте позиций.
 *
 * ── Ранжирование ──────────────────────────────────────────────────────
 *
 * Совпадение с начала слова ценнее совпадения внутри слова: по запросу
 * «раб» человек ищет «рабов», а не «арабов».  Дальше — по порядку
 * следования в Коране, чтобы выдача была предсказуемой и не прыгала.
 */

import { getQuranSources, loadQuranSources } from '../content/quran-sources-lazy';
import { SURAHS, SURAH_BY_NUMBER, type SurahMeta } from '../content/surahs';
import { globalAyahNumber } from './ayahNumbering';
import { inhDisplayText } from './inhTranslation';

/** Максимум результатов по аятам.  Больше человек всё равно не
 *  просмотрит, а рендер длинного списка стоит заметно. */
const MAX_AYAH_HITS = 60;

/** Минимальная длина запроса для поиска по переводу.  На одной-двух
 *  буквах совпадёт половина Корана — это не результат, а шум. */
const MIN_QUERY_FOR_TEXT = 3;

export type AyahLang = 'inh' | 'ru';

/** Подпись перевода в выдаче поиска. */
export const AYAH_LANG_LABEL: Record<AyahLang, string> = {
  inh: 'ингушский',
  ru: 'русский',
};

export type AyahHit = {
  surah: number;
  ayah: number;
  /** Чей перевод совпал — для атрибута lang и подписи результата. */
  lang: AyahLang;
  /** Название суры для подписи результата. */
  surahTitle: string;
  /** Полный текст перевода — фрагмент вырезает уже компонент. */
  text: string;
  /** Позиция совпадения в исходном тексте. */
  matchStart: number;
  matchEnd: number;
};

export type SearchResult = {
  surahs: SurahMeta[];
  ayahs: AyahHit[];
  /** Совпадений по переводу больше, чем показано. */
  truncated: boolean;
  /** Запрос слишком короткий — по переводу не искали. */
  tooShortForText: boolean;
  /**
   * Словарь переводов ещё не догружен, по тексту не искали.
   *
   * quran-sources весит 3.7 МБ и грузится отдельным чанком, чтобы не
   * задерживать старт приложения. Экран поиска обязан показать это
   * состояние явно, а не пустую выдачу: «ничего не нашлось» и «ещё не
   * готово» — разные ответы.
   */
  notReady: boolean;
};

const COMBINING = /\p{M}/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;
/**
 * Латинские двойники кириллицы, которые в ингушском источнике стоят внутри
 * кириллических слов: ударные «тóхар», «Iáьржа» и просто опечатки набора —
 * «cийле» (62:4), «Mи» (44:1).  В любом регистре похожи a c e o p x y,
 * только заглавными — B H K M T.
 */
const LOOKALIKE_ANY_CASE: Record<string, string> = {
  a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у',
};
const LOOKALIKE_UPPER: Record<string, string> = {
  B: 'в', H: 'н', K: 'к', M: 'м', T: 'т',
};

function isCyrillicCode(code: number): boolean {
  return code >= 0x400 && code <= 0x52f;
}

/** Стоит ли рядом с позицией i кириллическая буква.  За пределами строки
 *  charCodeAt даёт NaN, и сравнение просто ложно. */
function cyrNear(s: string, i: number): boolean {
  return isCyrillicCode(s.charCodeAt(i - 1)) || isCyrillicCode(s.charCodeAt(i + 1));
}

/** Латинская буква A–Z/a–z (уже без диакритики) в позиции i. */
function foldLatin(letter: string, s: string, i: number): string {
  const lower = letter.toLowerCase();
  const twin = LOOKALIKE_UPPER[letter] ?? LOOKALIKE_ANY_CASE[lower];
  // Палочку «I» не трогаем: у неё нет кириллического двойника в словаре.
  return twin && cyrNear(s, i) ? twin : lower;
}

/**
 * Символ s[i] → его вид для сравнения.
 * '' — символ не участвует (знак ударения); ' ' — разделитель слов.
 *
 * Сначала — проверки по коду символа: это горячий цикл по полутора
 * миллионам символов двух переводов, и регулярные выражения на каждый
 * символ стоили ~0.8 с на первом поиске.  Регулярки остались только для
 * редких символов вне латиницы и основной кириллицы.
 *
 * Разложение NFD — только для латиницы с диакритикой: кириллическую «й»
 * раскладывать нельзя, она превратилась бы в «и».
 */
function foldChar(s: string, i: number): string {
  const code = s.charCodeAt(i);
  const ch = s[i];

  if (code < 0x80) {
    if ((code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a)) return foldLatin(ch, s, i);
    if (code >= 0x30 && code <= 0x39) return code === 0x31 && cyrNear(s, i) ? 'i' : ch;
    return ' ';
  }
  if (code >= 0x430 && code <= 0x44f) return ch;                         // а–я
  if (code >= 0x410 && code <= 0x42f) return String.fromCharCode(code + 32); // А–Я
  if (code === 0x401 || code === 0x451) return 'е';                     // Ё ё
  // Палочка: Ӏ ӏ, а также украинская І і, которой её часто набирают.
  if (code === 0x4c0 || code === 0x4cf || code === 0x406 || code === 0x456) return 'i';
  if (code === 0x40d || code === 0x45d) return 'и';                     // Ѝ ѝ
  if (code >= 0x300 && code <= 0x36f) return '';                        // ударение и пр.
  if (code >= 0xc0 && code <= 0x24f) {
    const base = ch.normalize('NFD').charAt(0);
    const b = base.charCodeAt(0);
    if ((b >= 0x61 && b <= 0x7a) || (b >= 0x41 && b <= 0x5a)) return foldLatin(base, s, i);
  }
  if (COMBINING.test(ch)) return '';
  const lower = ch.toLowerCase();
  return WORD_CHAR.test(lower) ? lower : ' ';
}

/**
 * Сравнимый вид строки и карта позиций: norm[i] пришёл из original[map[i]].
 * Ведущие и повторные разделители схлопываются, хвостовой срезается.
 */
function fold(original: string): { norm: string; map: Int32Array } {
  const parts: string[] = [];
  const positions: number[] = [];
  let lastWasSpace = true;   // ведущие пробелы съедаем
  for (let i = 0; i < original.length; i++) {
    const out = foldChar(original, i);
    if (!out) continue;
    if (out === ' ') {
      if (lastWasSpace) continue;
      positions.push(i);
      parts.push(' ');
      lastWasSpace = true;
      continue;
    }
    // toLowerCase изредка даёт два символа («İ» → «i̇») — каждый со своей
    // записью в карте, указывающей на один исходный символ.
    for (let k = 0; k < out.length; k++) {
      positions.push(i);
      parts.push(out[k]);
    }
    lastWasSpace = false;
  }
  if (lastWasSpace && parts.length > 0) {
    parts.pop();
    positions.pop();
  }
  return { norm: parts.join(''), map: Int32Array.from(positions) };
}

/** Приведение к сравнимому виду: нижний регистр, ё→е, палочка и знаки
 *  ударения (см. шапку), пунктуация в пробелы, схлопывание пробелов. */
export function normalise(s: string): string {
  return fold(s).norm;
}

/**
 * Нормализованная копия перевода каждого аята + карта позиций обратно
 * в исходную строку.
 *
 * Зачем карта: искать надо по нормализованному тексту (без запятых,
 * с «е» вместо «ё»), а подсвечивать — в оригинале, иначе пользователь
 * увидит покалеченную цитату вместо перевода.  Длины строк не
 * совпадают, поэтому храним для каждой позиции нормализованного текста
 * соответствующий индекс в исходном.
 *
 * Строится лениво при первом поиске: на старте приложения он не нужен.
 */
type Prepared = {
  key: string;
  surah: number;
  ayah: number;
  lang: AyahLang;
  original: string;
  norm: string;
  /** norm[i] пришёл из original[map[i]] */
  map: Int32Array;
};

type SourceEntry = [string, { surah: number; ayah: number; translations: { ru?: string; inh?: string } }];

let prepared: Prepared[] | null = null;
/** Недостроенный словарь: подготовка идёт порциями (см. warmSearchIndex). */
let building: { entries: SourceEntry[]; next: number; out: Prepared[] } | null = null;
let warming = false;

/** Прогреть словарь переводов. Вызывать до первого search() по тексту. */
export function ensureSearchReady(): Promise<unknown> {
  return loadQuranSources();
}

/** Сколько аятов готовить за одну порцию прогрева: ~10 мс на телефоне,
 *  кадр не пропадает. */
const WARM_SLICE = 250;

/**
 * Подготовить поисковый словарь заранее, порциями между кадрами.
 *
 * Два перевода — полтора миллиона символов; разом это ~0.15 с на сервере
 * и заметно дольше на телефоне.  Если ждать первой буквы, ввод замирает.
 * Поэтому панель поиска зовёт прогрев при открытии, а он режет работу на
 * порции через setTimeout (не rAF — тот не тикает в скрытой вкладке, см.
 * CLAUDE.md, «Грабли»).  Если человек начнёт искать раньше, search()
 * синхронно доделает остаток — результат тот же.
 */
export function warmSearchIndex(): void {
  if (prepared || warming) return;
  warming = true;
  void loadQuranSources().then(sources => {
    const step = () => {
      if (prepared) { warming = false; return; }
      prepareStep(sources as unknown as Record<string, SourceEntry[1]>, WARM_SLICE);
      if (prepared) warming = false;
      else setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }, () => { warming = false; });
}

function prepareStep(sources: Record<string, SourceEntry[1]>, limit: number): void {
  if (prepared) return;
  if (!building) building = { entries: Object.entries(sources), next: 0, out: [] };
  const { entries, out } = building;
  const end = Math.min(entries.length, building.next + limit);
  for (let n = building.next; n < end; n++) {
    const [key, src] = entries[n];
    // Ингушский — тем же фильтром, что и на экране чтения: найти можно
    // только то, что под аятом и показывается (см. lib/inhTranslation.ts).
    const texts: [AyahLang, string | undefined][] = [
      ['inh', inhDisplayText(key, k => sources[k]?.translations.inh)],
      ['ru', src.translations.ru],
    ];
    for (const [lang, original] of texts) {
      if (!original) continue;
      const { norm, map } = fold(original);
      out.push({ key, surah: src.surah, ayah: src.ayah, lang, original, norm, map });
    }
  }
  building.next = end;
  if (end < entries.length) return;
  // Порядок мусхафа — выдача должна идти сверху вниз по Корану.  Внутри
  // одного аята ингушский раньше русского: sort стабилен, а порядок
  // пушей выше уже такой.
  out.sort((a, b) =>
    globalAyahNumber(a.surah, a.ayah) - globalAyahNumber(b.surah, b.ayah));
  prepared = out;
  building = null;
}

function prepare(sources: Record<string, SourceEntry[1]>): Prepared[] {
  prepareStep(sources, Infinity);
  return prepared!;
}

/**
 * Какие переводы искать: те, что человек видит в ленте (ключи `showInh`
 * и `showRu` экрана суры).  Если скрыты оба — ищем по обоим: читатель
 * может оставить один арабский, но искать ему всё равно надо.
 */
export function visibleSearchLangs(): AyahLang[] {
  try {
    const langs: AyahLang[] = [];
    if (localStorage.getItem('showInh') !== '0') langs.push('inh');
    if (localStorage.getItem('showRu') !== '0') langs.push('ru');
    return langs.length ? langs : ['inh', 'ru'];
  } catch {
    return ['inh', 'ru'];
  }
}

/** Поиск сур по номеру, транслитерации, переводу названия и арабскому. */
function searchSurahs(raw: string, norm: string): SurahMeta[] {
  if (!norm) return [];
  const asNumber = parseInt(raw, 10);
  return SURAHS.filter(s => {
    if (Number.isInteger(asNumber) && String(s.number) === raw.trim()) return true;
    return normalise(s.transliteration).includes(norm)
      || normalise(s.russian).includes(norm)
      || s.arabic.includes(raw.trim());
  });
}

/**
 * Только суры по названию или номеру — без поиска по переводам.
 *
 * Для выбора суры в плеере: там ищут суру, а не аят, и строить словарь
 * переводов ради этого незачем. Правила совпадения те же, что у главной,
 * чтобы один и тот же запрос находил одно и то же в обоих местах.
 */
export function findSurahs(raw: string): SurahMeta[] {
  return searchSurahs(raw, normalise(raw));
}

export type SearchOptions = {
  /**
   * Искать только внутри одной суры.  Нужен для поиска из экрана
   * чтения: человек уже читает конкретную суру, и «найти у себя»
   * — самый частый запрос.  В этом режиме поиск по названиям сур
   * не выполняется: искать сам себя бессмысленно.
   */
  surah?: number;
  /** В каких переводах искать; по умолчанию — в обоих. */
  langs?: AyahLang[];
};

/**
 * Основной поиск.  Возвращает и суры, и аяты — экран решает, что
 * показать.
 */
export function search(raw: string, opts: SearchOptions = {}): SearchResult {
  const norm = normalise(raw);
  const empty: SearchResult = {
    surahs: [], ayahs: [], truncated: false, tooShortForText: false, notReady: false,
  };
  if (!norm) return empty;

  const scoped = opts.surah != null;
  const surahs = scoped ? [] : searchSurahs(raw, norm);

  if (norm.replace(/\s/g, '').length < MIN_QUERY_FOR_TEXT) {
    return { surahs, ayahs: [], truncated: false, tooShortForText: true, notReady: false };
  }

  // Поиск по названиям сур работает всегда: SURAHS лежит в главном чанке.
  // По переводу ищем только когда словарь доехал.
  const sources = getQuranSources();
  if (!sources) {
    return { surahs, ayahs: [], truncated: false, tooShortForText: false, notReady: true };
  }

  /*
   * Один список, а не два.
   *
   * Раньше совпадения делились на «с начала слова» и «внутри слова» и
   * склеивались как `[...strong, ...weak]`.  Внутри каждого списка
   * порядок мусхафа соблюдался, но склейка его рвала: аят из 2-й суры,
   * где слово нашлось внутри другого, оказывался ниже аята из 27-й.
   * Человек читает выдачу как оглавление — она обязана идти сверху
   * вниз по Корану.
   *
   * Отдельная сортировка не нужна: `prepare()` уже отдаёт аяты в
   * порядке мусхафа, и мы идём по ним подряд.
   */
  const hits: AyahHit[] = [];
  let total = 0;
  // Вышли ли из цикла досрочно.  Без этого флага «обрезано» считалось
  // как total > показанных, а при досрочном выходе total равен числу
  // показанных — и признак молча терялся ровно в том случае, ради
  // которого он и нужен.  Поймано тестом.
  let stoppedEarly = false;

  // Один аят — один результат, даже если запрос нашёлся в обоих
  // переводах: показываем первый (ингушский), русский пропускаем.
  let lastHitKey = '';
  for (const p of prepare(sources)) {
    if (scoped && p.surah !== opts.surah) continue;
    if (p.key === lastHitKey) continue;
    if (opts.langs && !opts.langs.includes(p.lang)) continue;
    const at = p.norm.indexOf(norm);
    if (at === -1) continue;
    lastHitKey = p.key;
    total++;
    // Конец совпадения в оригинале: берём позицию последнего символа
    // и добавляем единицу.  map хранит начало каждого символа, поэтому
    // для конца смотрим следующий индекс, а на границе — длину строки.
    const startOrig = p.map[at];
    const lastIdx = at + norm.length - 1;
    const endOrig = lastIdx + 1 < p.norm.length
      ? p.map[lastIdx + 1]
      : p.original.length;

    const hit: AyahHit = {
      surah: p.surah,
      ayah: p.ayah,
      lang: p.lang,
      surahTitle: SURAH_BY_NUMBER[p.surah]?.transliteration ?? `Сура ${p.surah}`,
      text: p.original,
      matchStart: startOrig,
      matchEnd: endOrig,
    };
    hits.push(hit);
    // Лимит теперь на общее число найденного, а не на одну из двух
    // корзин — иначе при обрыве терялись бы уже собранные совпадения.
    if (hits.length >= MAX_AYAH_HITS) { stoppedEarly = true; break; }
  }

  const ayahs = hits;
  return {
    surahs,
    ayahs,
    truncated: stoppedEarly || total > ayahs.length,
    tooShortForText: false,
    notReady: false,
  };
}

/**
 * Фрагмент вокруг совпадения — чтобы длинный аят не занимал пол-экрана.
 * Возвращает три части: до, само совпадение, после.
 */
export function snippet(hit: AyahHit, radius = 60): {
  before: string; match: string; after: string;
} {
  const { text, matchStart, matchEnd } = hit;
  let from = Math.max(0, matchStart - radius);
  let to = Math.min(text.length, matchEnd + radius);
  // Не режем посреди слова — отходим до ближайшего пробела.
  if (from > 0) {
    const sp = text.indexOf(' ', from);
    if (sp !== -1 && sp < matchStart) from = sp + 1;
  }
  if (to < text.length) {
    const sp = text.lastIndexOf(' ', to);
    if (sp !== -1 && sp > matchEnd) to = sp;
  }
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, matchStart),
    match: text.slice(matchStart, matchEnd),
    after: text.slice(matchEnd, to) + (to < text.length ? '…' : ''),
  };
}
