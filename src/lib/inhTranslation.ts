/**
 * Ингушский перевод смыслов Корана — что из источника показывать на экране.
 *
 * Источник: «ГӀалгӀай — Сийдолча КъорӀан маӀана таржам (2023)», приложение
 * «Коран и Сунна» (`ing.galgaev.quran`), база
 * `data/inh-quran/quran_translation_ing_smisl.db`. В `quran-sources.ts`
 * текст лежит дословно (поле `translations.inh`, обрезаны только пробелы по
 * краям строки — на экране они всё равно не видны).
 *
 * Сам текст здесь НЕ правится — ни буквы. Модуль только решает, какую часть
 * записи источника показать, по принципу сомнения (CLAUDE.md, сакральные
 * правила § 4, вариант 2: «используешь только тот фрагмент, в котором нет
 * сомнения»). Сверка всей базы 2026-10-03 нашла ровно шесть аномалий:
 *
 * 1. В пяти записях после перевода аята стоит HTML-разделитель `<p>`, а за
 *    ним — не перевод этого аята:
 *      20:32 — пусто;
 *      28:22 — символ приватной зоны U+F02B (на экране — квадрат);
 *      78:36 — арабское слово «يَمْلِكُونَ» (начало 78:37);
 *      87:5  — символ приватной зоны U+F09D;
 *      50:40 — «41. Iа ладувгIалахь…» — перевод СЛЕДУЮЩЕГО аята 50:41.
 *    Показываем только часть до `<p>`: это и есть перевод самого аята.
 *
 * 2. Начиная с 50:41 и до конца суры источник сдвинут на один аят: перевод
 *    50:41 приклеен к записи 50:40 (после `<p>`, с номером «41.»), в записи
 *    50:41 лежит перевод 50:42, …, в 50:44 — перевод 50:45, а 50:45 пуст
 *    (в базе тафсира `ing_tafs` тот же сдвиг). Сверено по смыслу с Кулиевым
 *    для каждого аята. Решение владельца 2026-10-03: переставить записи на
 *    свои места — см. INH_REMAP. Текст не меняется; у перевода 50:41
 *    отбрасывается только номер «41. », стоящий перед ним в источнике.
 */

import { LATIN_FONTS, latinStack, type LatinFontId } from './typography';

/** Как источник подписан в самом приложении «Коран и Сунна». */
export const INH_SOURCE_TITLE = 'ГӀалгӀай — Сийдолча КъорӀан маӀана таржам (2023)';
export const INH_SOURCE_APP = '«Коран и Сунна» (ing.galgaev.quran)';

const PARAGRAPH_TAG = '<p>';

/**
 * Перестановка сдвинутых записей конца суры 50 (п. 2 шапки).
 * `from` — чья запись источника, `part` — какая её часть:
 *   'after-p' — то, что идёт после `<p>` (без номера аята перед текстом);
 *   'whole'   — вся запись (с обычной обрезкой хвоста после `<p>`).
 * Ключи без записи здесь берут свою собственную запись.
 */
const INH_REMAP: Record<string, { from: string; part: 'after-p' | 'whole' }> = {
  '50:41': { from: '50:40', part: 'after-p' },
  '50:42': { from: '50:41', part: 'whole' },
  '50:43': { from: '50:42', part: 'whole' },
  '50:44': { from: '50:43', part: 'whole' },
  '50:45': { from: '50:44', part: 'whole' },
};

/** Запись источника по ключу аята — обычно `sources[key]?.translations.inh`. */
export type InhRawLookup = (verseKey: string) => string | undefined;

/** Ключ localStorage «показывать ингушский перевод» ('0' — скрыт). */
export const INH_VISIBLE_KEY = 'showInh';

/** Видим ли ингушский перевод. По умолчанию — да: приложение ингушское. */
export function readShowInh(): boolean {
  try {
    return localStorage.getItem(INH_VISIBLE_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Текст ингушского перевода для показа под аятом, или `undefined`, если
 * показывать нечего.  Принимает доступ к записям источника, а не одну
 * запись: для конца суры 50 перевод лежит в соседней записи (INH_REMAP).
 */
export function inhDisplayText(verseKey: string, rawOf: InhRawLookup): string | undefined {
  const remap = INH_REMAP[verseKey];
  const raw = rawOf(remap ? remap.from : verseKey);
  if (!raw) return undefined;
  const cut = raw.indexOf(PARAGRAPH_TAG);
  if (remap?.part === 'after-p') {
    if (cut === -1) return undefined;
    const ayah = verseKey.split(':')[1];
    const tail = raw.slice(cut + PARAGRAPH_TAG.length).trim();
    const numbered = `${ayah}. `;
    return (tail.startsWith(numbered) ? tail.slice(numbered.length) : tail) || undefined;
  }
  const text = cut === -1 ? raw : raw.slice(0, cut).trimEnd();
  return text || undefined;
}

/**
 * Шрифтовой стек ингушского текста для выбранного шрифта чтения.
 *
 * - Inter заменяется на 'Inter Ingush' — своё подмножество Inter 4.1, где
 *   ударение над кириллицей стоит на месте и есть cv08 (I с засечками —
 *   палочку не спутать с «l»). Почему не подмножество Google — в index.css.
 * - Первым стоит `Inh Marks`: ровно один символ, лигатура ﷺ (U+FDFA), которой
 *   нет ни в одном шрифте чтения. Скачивается, только если ﷺ на экране.
 *
 * EB Garamond и Alice берутся как есть: ударение и «I» в них верные.
 */
export function inhFontStack(font: LatinFontId): string {
  const base = latinStack(font);
  const body = font.startsWith('inter') ? base.replace("'Inter'", "'Inter Ingush'") : base;
  return `'Inh Marks', ${body}`;
}

/** Включение I с засечками (cv08) — действует только в 'Inter Ingush'. */
export const INH_FONT_FEATURES = "'cv08' 1";

/** Варианты шрифта для вкладки «Ингушский»: образец рисуется тем же
 *  стеком, каким будет набран перевод. */
export const INH_FONT_OPTIONS = LATIN_FONTS.map(f => ({ ...f, stack: inhFontStack(f.id) }));
