/**
 * QcfAyahLine — renders a single ayah using QCF V4 PUA glyphs.
 *
 * Approach (matches qul-cc / quran.com reference renderers):
 *   • Each word is a <span> with its specific QCF font.  Words live in
 *     mushaf reading order (position 1 first) inside a `dir="rtl"`
 *     container, separated by regular spaces.
 *   • CRITICAL: every chunk wrapper carries `unicode-bidi: isolate`.
 *     Why — QCF PUA codepoints (U+F100..) are strong-LTR by Unicode
 *     bidi class.  Without isolation, the entire ayah collapses into
 *     one LTR run and renders left-to-right, putting word 1 on the
 *     LEFT and the end-marker on the RIGHT (verified empirically).
 *     Isolation makes each chunk an atomic bidi unit; the parent's
 *     RTL direction then orders them right-to-left so word 1 lands at
 *     the rightmost edge and the end-marker at the leftmost — as in
 *     the mushaf.
 *   • Word ordering is verified against /qcf4/pages/001.json line 2
 *     (Al-Fatiha v1: bismi → Allah → al-Rahman → al-Rahim → V1) —
 *     positions 1..5 match mushaf reading order.
 *   • The end-marker glyph (type='end') is kept on the same line as
 *     the preceding word via a nowrap chunk, so it never orphans.
 *   • No letter-spacing / word-spacing / margin overrides — the QCF
 *     glyph metrics already include the proper inter-word breathing
 *     room.  Adding extra spacing distorts the calligraphy.
 *   • Note on the no-`inline-block`/no-`isolate`-between-letters rule
 *     in CLAUDE.md: that rule protects the cursive joining BETWEEN
 *     LETTERS within a word.  In QCF V4 every "word" in the data is a
 *     single PUA codepoint that maps to a fully pre-shaped word glyph,
 *     so word-level isolation never touches letter shaping.
 *
 * Karaoke highlighting:
 *   activeWordPos === word.position → [data-active-word] attribute.
 *   В glow-режиме QCF намеренно не использует общий движущийся
 *   AyahGlowLayer и text-shadow: iOS Safari при их анимации повторно
 *   растрировал PUA-шрифт и на отдельных кадрах терял части глифов.
 *   CSS рисует неподвижную подложку за тем же DOM-элементом, поэтому
 *   содержимое и слой арабского текста вообще не меняются.
 */

import { Fragment, useLayoutEffect, useRef } from 'react';
import { useQcfFont } from '../hooks/useQcfFont';
import { useNearViewport } from '../hooks/useNearViewport';
import { ArabicSkeleton } from './ArabicSkeleton';
import { qcfPageFamily, type QcfWord, type QcfFontRef } from '../lib/qcf4';

type Props = {
  /** Words composing this ayah, in mushaf reading order (position 1 = first) */
  words: QcfWord[];
  /** Подмножества шрифтов, нужные словам — пары «шрифт + страница» */
  fonts: QcfFontRef[];
  /** 1-based word position currently being recited, or null */
  activeWordPos?: number | null;
  /** Whether the WHOLE ayah is the active one (controls highlight visibility) */
  isActive?: boolean;
  /** px size at scale=1.0 — comfortable for mobile reading */
  scale?: number;
  /**
   * Просить шрифт сразу, не дожидаясь наблюдателя видимости.
   *
   * Нужно для аятов, которые точно окажутся на первом экране.  Наблюдатель
   * присылает свой вердикт асинхронно, а при монтировании длинной суры
   * основной поток занят: у Ан-Нахль (128 аятов) первый вердикт приходил
   * через две секунды ПОСЛЕ того, как шрифт был уже загружен, и человек
   * ровно столько смотрел на скелет впустую.
   */
  eager?: boolean;
  /** Optional tap handler for the ayah (play / focus) */
  onTap?: () => void;
};

/**
 * px size at scale=1.0.  Across the four scale presets (0.85/1.0/1.2/1.4):
 *   40 / 47 / 56 / 66 px
 */
const BASE_FONT_PX = 47;

/**
 * Group the ayah's words into chunks for line-wrap control.  The only
 * non-trivial chunk is the LAST WORD + end-marker — they're rendered in a
 * single nowrap <span> so the ornate "﴿N﴾" glyph can never wrap onto its
 * own line by itself.  Every other word stays in its own chunk and the
 * browser is free to wrap between them at natural word boundaries.
 */
function chunkWords(words: QcfWord[]): QcfWord[][] {
  const chunks: QcfWord[][] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = words[i + 1];
    if (next && next.type === 'end') {
      chunks.push([word, next]);
      i++; // consume the end-marker too
    } else {
      chunks.push([word]);
    }
  }
  return chunks;
}

/**
 * Сколько слов мусхафа помещается в строку — измеренное, а не угаданное.
 *
 * Скелет обязан занимать столько же места, сколько займёт текст: иначе при
 * подмене страница прыгает, и прыгает она у аята ВЫШЕ вьюпорта, то есть
 * прямо под пальцем читающего. WebKit не поддерживает scroll anchoring,
 * компенсировать нечем.
 *
 * Раньше здесь стояла константа «около 5.5 слов на строку». Она верна для
 * одного сочетания кегля и ширины экрана и промахивается на всех прочих:
 * на планшете и при мелком кегле слов помещается заметно больше, скелет
 * выходил выше текста, и при подмене лента подтягивалась вверх.
 *
 * Считать ширину слова заранее нельзя — глифы PUA, метрик до загрузки
 * шрифта нет. Поэтому калибруемся по факту: первый же аят, у которого
 * шрифт приехал, даёт отношение «слов на строку» для своей пары
 * (кегль, ширина). Остальные скелеты этой же пары используют измеренное.
 *
 * Ширина округляется до 20 px: точное значение не нужно, а грубые корзины
 * не дают пересчитывать калибровку от каждого пикселя при повороте.
 */
const wordsPerLine = new Map<string, number>();
const LINE_HEIGHT = 1.85;
/** Пока не измерили — прежняя оценка. Она хотя бы не хуже, чем была. */
const FALLBACK_WORDS_PER_LINE = 5.5;

function calibrationKey(fontSize: number, width: number): string {
  return `${Math.round(fontSize)}|${Math.round(width / 20)}`;
}

/**
 * Ширина колонки аятов — одна на всю ленту (все аяты в одной колонке).
 *
 * Прежде `estimatedLines()` читал `clientWidth` каждого аята прямо в
 * рендере. Замер 2026-10-04 (Chromium, процессор ×4): 125 мс на открытии
 * Аль-Бакары уходило на вынужденный пересчёт раскладки — каждый батч ленты
 * в рендере читал геометрию после изменений DOM прошлого батча. Теперь в
 * рендере геометрия не читается: ширину меряет layout-эффект (в одном
 * коммите это один пересчёт на все аяты), аят помнит свою, а скелеты ещё
 * не нарисованных аятов берут первую измеренную ширину ленты. Шторка
 * тафсира рисует аят уже, но общую ширину не перебивает: её задаёт первый
 * замер, сбрасывает только resize (поворот, iPad).
 */
let columnWidth = 0;
if (typeof window !== 'undefined') {
  // Только при смене ширины окна: resize приходит и от клавиатуры, и от
  // уезжающей адресной строки Safari — ширина колонки при этом прежняя.
  let lastWindowWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWindowWidth) return;
    lastWindowWidth = window.innerWidth;
    columnWidth = 0;
  });
}

export function QcfAyahLine({
  words,
  fonts,
  activeWordPos = null,
  isActive = false,
  scale = 1.0,
  eager = false,
  onTap,
}: Props) {
  const fontSize = BASE_FONT_PX * scale;
  const chunks = chunkWords(words);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Шрифт просим, только когда аят подошёл к экрану.  Сура смонтирована
  // целиком (см. useChunkedRender), и без этого условия Ан-Ниса разом
  // запрашивала 32 подмножества — файл первого экрана приходил вместе с
  // последними.  Подробнее в hooks/useNearViewport.ts.
  //
  // Пока шрифт не готов, на месте аята стоит скелет, а не кубики: у
  // PUA-глифов запасного шрифта не существует.
  const near = useNearViewport(containerRef, !eager);
  const fontsReady = useQcfFont(fonts, eager || near);

  // Калибровка: измеряем ровно один раз на пару (кегль, ширина) и только
  // по аяту, у которого текст уже нарисован. Дальше замер не повторяется —
  // на горячем пути прокрутки лишних чтений геометрии быть не должно.
  const widthRef = useRef(0);
  useLayoutEffect(() => {
    if (!fontsReady) return;
    const el = containerRef.current;
    if (!el || words.length === 0) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    widthRef.current = width;
    if (columnWidth === 0) columnWidth = width;
    const key = calibrationKey(fontSize, width);
    if (wordsPerLine.has(key)) return;
    // Высота без вертикальных полей: они не участвуют в числе строк.
    const inner = el.clientHeight - 8;
    const lines = Math.round(inner / (fontSize * LINE_HEIGHT));
    if (lines >= 1) wordsPerLine.set(key, words.length / lines);
  }, [fontsReady, fontSize, words.length]);

  const estimatedLines = () => {
    // Без чтения геометрии в рендере (см. columnWidth).
    const width = widthRef.current || columnWidth;
    const perLine = (width > 0 ? wordsPerLine.get(calibrationKey(fontSize, width)) : undefined)
      ?? FALLBACK_WORDS_PER_LINE;
    return Math.max(1, Math.ceil(words.length / perLine));
  };

  return (
    <div
      ref={containerRef}
      className="qcf-ayah-line"
      onClick={onTap}
      dir="rtl"
      style={{
        direction: 'rtl',
        textAlign: 'right',
        lineHeight: 1.85,
        fontSize: `${fontSize}px`,
        userSelect: 'none',
        cursor: onTap ? 'pointer' : 'default',
        padding: '4px 2px',
      }}
    >
      {/* Шрифт ещё едет — держим место скелетом.  Кубики вместо слов аята
          недопустимы, а скелет той же высоты не даёт странице прыгнуть,
          когда текст появится.  Число строк — из измеренной калибровки
          (см. wordsPerLine выше), а не из константы. */}
      {!fontsReady ? (
        <ArabicSkeleton
          lines={estimatedLines()}
          fontSize={fontSize}
          align="right"
        />
      ) : chunks.map((chunk, idx) => (
        <Fragment key={idx}>
          <span
            style={{
              // Each chunk is its own bidi unit so the parent's RTL direction
              // orders chunks right-to-left.  See file header for full rationale.
              unicodeBidi: 'isolate',
              whiteSpace: 'nowrap',
            }}
            dir="rtl"
          >
            {chunk.map((word, i) => {
              // End-markers don't have a `position` field, so they never
              // receive the active-word attribute.
              return (
                <QcfWordSpan
                  key={i}
                  word={word}
                  isActive={isActive && word.position === activeWordPos}
                />
              );
            })}
          </span>
          {/* Real space between chunks lives OUTSIDE the isolated wrapper, so
              it stays in the parent's RTL flow as a normal word-break / line-
              wrap opportunity.  No U+200B hacks (zero-width spaces adjacent
              to RTL runs can confuse bidi heuristics). */}
          {idx < chunks.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </div>
  );
}

// ─── Per-word span ─────────────────────────────────────────────────────────────

type WordSpanProps = {
  word: QcfWord;
  isActive: boolean;
};

function QcfWordSpan({ word, isActive }: WordSpanProps) {
  return (
    <span
      className="qcf-word-glyph"
      {...(isActive ? { 'data-active-word': '' } : {})}
      {...(word.verse_key ? { 'data-verse-key': word.verse_key } : {})}
      {...(word.position  ? { 'data-position':  word.position  } : {})}
      dir="rtl"
      style={{
        // Семейство с суффиксом страницы: одни и те же PUA-коды в разных
        // шрифтах означают разные слова, поэтому подмножества страниц не
        // должны делить имя — иначе в аяте окажется чужое слово.
        // `?? ''` — только ради типа: поле стало необязательным из-за
        // данных V1, но лента работает на V4, где шрифт назван у каждого
        // слова (проверено по всем 604 файлам).  Если он всё же окажется
        // пустым, семейство выйдет `_p106`, такого `@font-face` нет, и
        // браузер откатится на serif — то есть покажет КУБИК, а не пустое
        // место.  Поэтому пустой `font` здесь недопустим, а не безобиден.
        fontFamily: `'${qcfPageFamily(word.font ?? '', word.page ?? 0)}', serif`,
        // Default colour for inactive words. The active-word colour is
        // applied via the CSS `[data-active-word]` rule (with !important
        // to win against this inline default) so the user's theme- and
        // colour-pick from settings can change it at runtime without
        // re-rendering the spans.
        color: 'var(--qcf-text, var(--text-primary))',
        // Each word is its own bidi unit so that, inside a multi-word chunk
        // (e.g. last-word + end-marker), the words are still ordered RTL.
        // Without this, two PUA chars sharing one isolated chunk merge into a
        // single LTR run and render in DOM order (left-to-right) — see the
        // file-header explanation of the underlying bidi behaviour.
        unicodeBidi: 'isolate',
      }}
      aria-label={word.text || undefined}
    >
      {word.char}
    </span>
  );
}
