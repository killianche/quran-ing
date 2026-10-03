/**
 * TafsirSheet — окно «Тафсир ас-Саади» по кнопке у аята.
 *
 * Нижняя панель (SettingsSheet): смах вниз, системный «назад» и Esc её
 * закрывают, содержимое прокручивается.
 *
 * Что внутри, сверху вниз:
 *   1. откуда аят и какой фрагмент толкует ас-Саади («аяты 1–6»);
 *   2. сам аят — арабский тем же начертанием, что в ленте, ингушский и
 *      русский переводы по настройкам чтения, номер «сура:аят».  Правило
 *      видимости (CLAUDE.md): где цитируется аят, на экране и арабский, и
 *      перевод, и ссылка;
 *   3. если фрагмент длиннее одного аята — «Все аяты фрагмента»: раскрывает
 *      остальные аяты, о которых идёт речь в толковании;
 *   4. текст толкования — шрифтом и кеглем русского перевода из настроек;
 *   5. подпись источника.
 *
 * Данные — lib/tafsir.ts; грузится только файл открытой суры.
 */

import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { SettingsSheet } from './ReadingSettings';
import { ArabicAyahRouter } from './ArabicAyahRouter';
import type { QcfAyahEntry } from '../hooks/useQcfAyahFeed';
import type { QuranSources } from '../content/quran-sources-lazy';
import {
  TAFSIR_ATTRIBUTION, TAFSIR_TITLE,
  loadSurahTafsir, tafsirGroupFor, tafsirParagraphs,
  type TafsirGroup,
} from '../lib/tafsir';
import { INH_FONT_FEATURES, inhDisplayText, inhFontStack } from '../lib/inhTranslation';
import {
  latinIsSerif, latinStack, latinWeight,
  type ArabicFontId, type LatinFontId,
} from '../lib/typography';

type Props = {
  surah: number;
  ayah: number;
  surahTitle: string;
  /** Данные ленты для аята этой суры — чтобы арабский был тем же, что в ленте. */
  entryOf: (ayah: number) => QcfAyahEntry | undefined;
  sources: QuranSources;
  arabicFont: ArabicFontId;
  arabicScale: number;
  showInh: boolean;
  showRu: boolean;
  inhFont: LatinFontId;
  inhScale: number;
  ruFont: LatinFontId;
  ruScale: number;
  onClose: () => void;
};

type State =
  | { status: 'loading' }
  | { status: 'ready'; group: TafsirGroup | undefined }
  | { status: 'error' };

/**
 * memo: экран суры перерисовывается на каждом тике аудио (~60 раз в секунду
 * во время чтения).  Без memo вместе с ним перерисовывалось бы и окно — до
 * 69 карточек аятов и 50 КБ толкования.  Все пропсы стабильны по ссылке
 * (колбэки — useCallback в SurahScreen).
 */
export const TafsirSheet = memo(function TafsirSheet(p: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [allAyahs, setAllAyahs] = useState(false);
  useEffect(() => setAllAyahs(false), [p.surah, p.ayah]);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    loadSurahTafsir(p.surah).then(
      data => { if (alive) setState({ status: 'ready', group: tafsirGroupFor(data, p.ayah) }); },
      () => { if (alive) setState({ status: 'error' }); },
    );
    return () => { alive = false; };
  }, [p.surah, p.ayah, attempt]);

  const group = state.status === 'ready' ? state.group : undefined;
  const isFragment = !!group && group.to > group.from;
  const ayahsToShow = group && isFragment && allAyahs
    ? Array.from({ length: group.to - group.from + 1 }, (_, i) => group.from + i)
    : [p.ayah];
  const paragraphs = useMemo(() => (group ? tafsirParagraphs(group.text) : []), [group]);

  return (
    <SettingsSheet onClose={p.onClose} title={TAFSIR_TITLE} placement="bottom-sheet">
      <p style={caption}>
        {p.surahTitle} · аят {p.ayah}
        {isFragment && <> · толкование аятов {group!.from}–{group!.to}</>}
      </p>

      <div style={{ display: 'grid', gap: '10px' }}>
        {ayahsToShow.map(n => (
          <AyahCard
            key={n} {...p} ayah={n}
            current={n === p.ayah && ayahsToShow.length > 1}
            listed={ayahsToShow.length > 1}
          />
        ))}
      </div>

      {isFragment && (
        <button
          type="button"
          onClick={() => setAllAyahs(v => !v)}
          aria-expanded={allAyahs}
          style={disclosure}
        >
          {allAyahs
            ? 'Показать только этот аят'
            : `Все аяты фрагмента · ${group!.to - group!.from + 1}`}
        </button>
      )}

      <section aria-label="Толкование" style={{ marginTop: '18px' }}>
        <p style={sectionLabel}>Толкование</p>

        {state.status === 'loading' && (
          <div aria-busy="true" aria-label="Загрузка тафсира" style={{ display: 'grid', gap: '10px' }}>
            {[96, 100, 88, 94, 62].map((w, i) => (
              <div key={i} className="skeleton" style={{ height: '14px', borderRadius: '4px', width: `${w}%` }} />
            ))}
          </div>
        )}

        {state.status === 'error' && (
          <div role="alert" style={{ display: 'grid', gap: '10px', justifyItems: 'start' }}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-subhead)' }}>
              Не удалось загрузить тафсир.
            </p>
            <button type="button" onClick={() => setAttempt(n => n + 1)} style={retryButton}>
              Повторить
            </button>
          </div>
        )}

        {state.status === 'ready' && !group && (
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-subhead)' }}>
            Для этого аята толкования в источнике нет.
          </p>
        )}

        {state.status === 'ready' && group && (
          <div lang="ru" style={{
            fontFamily: latinStack(p.ruFont),
            fontWeight: latinWeight(p.ruFont),
            fontSize: translationFontSize(p.ruFont, p.ruScale),
            lineHeight: 1.6,
            color: 'var(--text-primary)',
            letterSpacing: '-0.005em',
          }}>
            {paragraphs.map((paragraph, i) => (
              <p key={i} style={{ margin: i === 0 ? 0 : '0.85em 0 0' }}>{paragraph}</p>
            ))}
          </div>
        )}
      </section>

      <p style={{ ...caption, margin: '22px 0 4px', lineHeight: 1.45 }}>{TAFSIR_ATTRIBUTION}</p>
    </SettingsSheet>
  );
});

/** Аят: арабский как в ленте + переводы по настройкам + номер. */
function AyahCard(p: Props & {
  /** Аят, по которому открыли тафсир, в раскрытом списке фрагмента. */
  current: boolean;
  /** Карточка в раскрытом списке «Все аяты фрагмента». */
  listed: boolean;
}) {
  const entry = p.entryOf(p.ayah);
  const key = `${p.surah}:${p.ayah}`;
  const source = p.sources[key];
  const inh = p.showInh ? inhDisplayText(key, k => p.sources[k]?.translations.inh) : undefined;
  // Если оба перевода скрыты в ленте, в тафсире всё равно нужен перевод
  // рядом с арабским — показываем русский.
  const ru = p.showRu || !inh ? source?.translations.ru : undefined;

  return (
    <article aria-current={p.current ? 'true' : undefined} style={{
      padding: '12px 14px',
      borderRadius: '14px',
      border: `1px solid ${p.current ? 'var(--text-tertiary)' : 'var(--hairline)'}`,
      background: 'rgb(var(--ink-rgb) / 0.03)',
    }}>
      {entry ? (
        <ArabicAyahRouter
          verseKey={entry.verseKey}
          ayahNumber={entry.ayah}
          pageNum={entry.pageNum}
          words={entry.words}
          fonts={entry.fonts}
          arabicFont={p.arabicFont}
          activeWordPos={null}
          isActive={false}
          scale={p.arabicScale * 0.85}
          // Сразу шрифт просит только аят, по которому открыли тафсир.
          // Остальные карточки фрагмента (до 69 в 7:103–171) — через
          // наблюдатель видимости, как в ленте: иначе разом заказывались бы
          // подмножества всех страниц фрагмента в обгон шрифтов ленты.
          eager={!p.listed || p.current}
        />
      ) : source?.arabic ? (
        // Запасной путь: данных ленты для аята нет — текстовый усмани.
        <p lang="ar" dir="rtl" style={{
          margin: 0,
          fontFamily: "'KFGQPC Uthmanic Hafs v22', serif",
          fontSize: `calc(26px * ${p.arabicScale})`,
          lineHeight: 1.9,
          color: 'var(--text-primary)',
        }}>
          {source.arabic}
        </p>
      ) : null}

      {inh && (
        <p lang="inh" style={{
          margin: '10px 0 0',
          fontFamily: inhFontStack(p.inhFont),
          fontFeatureSettings: INH_FONT_FEATURES,
          fontWeight: latinWeight(p.inhFont),
          fontSize: translationFontSize(p.inhFont, p.inhScale * 0.92),
          lineHeight: 1.45,
          color: 'var(--text-primary)',
        }}>
          {inh}
        </p>
      )}
      {ru && (
        <p lang="ru" style={{
          margin: inh ? '6px 0 0' : '10px 0 0',
          fontFamily: latinStack(p.ruFont),
          fontWeight: latinWeight(p.ruFont),
          fontSize: translationFontSize(p.ruFont, p.ruScale * 0.92),
          lineHeight: 1.45,
          color: 'var(--text-secondary)',
        }}>
          {ru}
        </p>
      )}

      <span style={refChip}>{key}</span>
    </article>
  );
}

/** Кегль перевода — та же формула, что в ленте (SurahScreen/AyahRow). */
function translationFontSize(font: LatinFontId, scale: number): string {
  const serifBump = scale >= 1.4 ? 10 : 5;
  return latinIsSerif(font)
    ? `calc(16px * ${scale} + ${serifBump}px)`
    : `calc(16px * ${scale})`;
}

const caption: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 'var(--font-caption1)',
  color: 'var(--text-tertiary)',
  letterSpacing: '0.01em',
};

const sectionLabel: CSSProperties = {
  margin: '0 0 10px',
  fontSize: 'var(--font-caption2)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--text-tertiary)',
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
};

const refChip: CSSProperties = {
  display: 'inline-block',
  marginTop: '10px',
  padding: '4px 10px',
  border: '1px solid var(--hairline)',
  borderRadius: '9999px',
  fontSize: 'var(--font-caption2)',
  color: 'var(--text-tertiary)',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1,
};

const disclosure: CSSProperties = {
  marginTop: '10px',
  minHeight: '44px',
  width: '100%',
  border: '1px solid var(--hairline)',
  borderRadius: '12px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontFamily: 'inherit',
  fontSize: 'var(--font-footnote)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
};

const retryButton: CSSProperties = {
  minHeight: '44px',
  padding: '0 18px',
  border: '1px solid var(--hairline)',
  borderRadius: '12px',
  background: 'rgb(var(--ink-rgb) / 0.05)',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 'var(--font-footnote)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
};
